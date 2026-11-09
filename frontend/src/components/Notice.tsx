export type NoticeState = { kind: 'success' | 'error' | 'info'; text: string; items?: string[] } | null;

const styles = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
};

/** Feedback banner for user actions: success confirmations and explicit errors. */
export function Notice({ notice, onClose }: { notice: NoticeState; onClose?: () => void }) {
  if (!notice) return null;
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${styles[notice.kind]}`}
    >
      <div>
        <p className="font-medium">{notice.text}</p>
        {notice.items && notice.items.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {notice.items.map((i) => <li key={i}>{i}</li>)}
          </ul>
        )}
      </div>
      {onClose && (
        <button onClick={onClose} aria-label="×" className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>
      )}
    </div>
  );
}
