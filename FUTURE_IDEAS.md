# DESHI GEE — Future Ideas & Deferred Enhancements

Ideas outside the locked Final Prompt V5 scope (recorded here per Section 0.4 instead of expanding scope):

1. **Real Gemini Embedding Vector Index (`gemini-embedding-2` / Vector Search):** Replace the deterministic lexical/semantic hybrid ranker once a live Gemini key and Firestore Vector Index are provisioned and benchmarked against 50+ real owner-supplied customer questions (`1-02`, `1-03`).
2. **Real-Time Live Audio Shopping Concierge:** Optional Bangla/English voice shopping using Gemini Live API after core text commerce and phone pilot metrics stabilize (`5-09`).
3. **Automated Multi-Warehouse / Batch-Level Lot Allocation:** Track stock per manufacturing batch (`batches/{batchId}`) with automatic FIFO deduction at order commit.
4. **Customer Loyalty Wallet & Subscription Cadence:** Optional monthly auto-refill subscription with bKash tokenization once payment gateway sandbox & compliance approvals are completed.
5. **Agentic Commerce Protocol Readiness (UCP / ACP):** Structured catalog & checkout feed exports for third-party shopping agents (`5-09`, low priority).
6. **Admin Staff Reply-Assist Drafts:** One-click AI draft replies inside the Human Support Inbox that require staff editing and explicit send (`5-09`).
7. **Automated CI Workflow for Emulator Rules + Chatbot Regression:** GitHub Actions workflow installing Temurin Java 17 + Firebase CLI to gate every PR on `npm run test:rules`, `npm test`, `npm run test:chatbot`, and `npm run build`.
