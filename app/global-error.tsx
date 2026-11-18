'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-[#FAF7F2] px-6 text-[#1E1710]">
        <div className="max-w-md rounded-2xl border border-[rgba(30,23,16,0.14)] bg-[#F2ECE1] p-8 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-sm text-[#635647]">
            {error?.message || 'An unexpected storefront error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-6 rounded-lg bg-[#B47B2B] px-5 py-2.5 text-sm font-medium text-[#FFFDF9] hover:bg-[#96621B]"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
