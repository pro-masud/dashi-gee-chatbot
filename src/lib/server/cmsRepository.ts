import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import { emptyCms, sanitizeCms, type CmsContent, type CmsVersionMeta } from '../cms/cms';
import { isTestProcessRuntime } from './runtimeGuards';

type Actor = { email: string; uid: string };

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  });
}

function readContent(raw: unknown): CmsContent {
  const parsed = sanitizeCms(raw);
  return parsed.ok ? parsed.value : emptyCms();
}

export interface CmsState {
  draft: CmsContent;
  published: CmsContent;
  /** true when the draft differs from what is live */
  hasUnpublishedChanges: boolean;
  publishedAtIso: string;
  versions: CmsVersionMeta[];
}

export async function readCmsState(): Promise<CmsState> {
  return wrap(async () => {
    const db = getAdminDb();
    const [draftSnap, pubSnap, versionSnap] = await Promise.all([
      db.collection('cms').doc('draft').get(),
      db.collection('cms').doc('published').get(),
      db.collection('cms_versions').orderBy('createdAtIso', 'desc').limit(20).get(),
    ]);
    const published = readContent(pubSnap.data()?.content);
    // Until the owner saves a draft, the draft starts as a copy of what is live.
    const draft = draftSnap.exists ? readContent(draftSnap.data()?.content) : published;
    return {
      draft,
      published,
      hasUnpublishedChanges: JSON.stringify(draft) !== JSON.stringify(published),
      publishedAtIso: String(pubSnap.data()?.publishedAtIso || ''),
      versions: versionSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          label: String(x.label || ''),
          createdAtIso: String(x.createdAtIso || ''),
          createdByEmail: String(x.createdByEmail || ''),
        };
      }),
    };
  });
}

export async function saveDraft(content: CmsContent, actor: Actor): Promise<void> {
  return wrap(async () => {
    const db = getAdminDb();
    const nowIso = new Date().toISOString();
    await db.collection('cms').doc('draft').set({ content, updatedAtIso: nowIso, updatedBy: actor.email });
  });
}

/** Publish = copy draft to published + keep a restorable version, in one transaction. */
export async function publishDraft(label: string, actor: Actor): Promise<{ versionId: string } | null> {
  return wrap(async () => {
    const db = getAdminDb();
    const draftRef = db.collection('cms').doc('draft');
    const pubRef = db.collection('cms').doc('published');
    const versionRef = db.collection('cms_versions').doc();
    const nowIso = new Date().toISOString();
    return db.runTransaction(async (tx) => {
      const [draftSnap, pubSnap] = await Promise.all([tx.get(draftRef), tx.get(pubRef)]);
      if (!draftSnap.exists) return null;
      const content = readContent(draftSnap.data()?.content);
      tx.set(pubRef, { content, publishedAtIso: nowIso, publishedBy: actor.email });
      tx.set(versionRef, {
        label: label.slice(0, 80) || 'Published',
        content,
        createdAtIso: nowIso,
        createdByEmail: actor.email,
      });
      tx.set(db.collection('activity_logs').doc(), {
        action: 'cms.publish',
        resource: 'cms/published',
        actorEmail: actor.email,
        actorUid: actor.uid,
        before: { hadPublished: pubSnap.exists },
        after: { versionId: versionRef.id, label },
        atIso: nowIso,
      });
      return { versionId: versionRef.id };
    });
  });
}

/** Restore copies a saved version into the DRAFT only; the owner reviews and publishes it again. */
export async function restoreVersionToDraft(versionId: string, actor: Actor): Promise<boolean> {
  return wrap(async () => {
    const db = getAdminDb();
    const snap = await db.collection('cms_versions').doc(versionId).get();
    if (!snap.exists) return false;
    const nowIso = new Date().toISOString();
    await db.collection('cms').doc('draft').set({ content: readContent(snap.data()?.content), updatedAtIso: nowIso, updatedBy: actor.email });
    await db.collection('activity_logs').add({
      action: 'cms.restore_to_draft',
      resource: `cms_versions/${versionId}`,
      actorEmail: actor.email,
      actorUid: actor.uid,
      before: null,
      after: { versionId },
      atIso: nowIso,
    });
    return true;
  });
}

/** Published content for the public storefront. Null when nothing is published or the DB is unreachable. */
export async function readPublishedBestEffort(): Promise<CmsContent | null> {
  if (isTestProcessRuntime()) return null;
  try {
    const snap = await getAdminDb().collection('cms').doc('published').get();
    return snap.exists ? readContent(snap.data()?.content) : null;
  } catch {
    return null;
  }
}
