import { EditOperationType } from '../types';

const config: Record<EditOperationType, { label: string; bg: string; text: string }> = {
  insert: { label: 'INS', bg: 'bg-green-100', text: 'text-green-700' },
  delete: { label: 'DEL', bg: 'bg-red-100', text: 'text-red-700' },
  update: { label: 'UPD', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  move: { label: 'MOV', bg: 'bg-blue-100', text: 'text-blue-700' },
};

export function OperationBadge({ type }: { type: EditOperationType }) {
  const { label, bg, text } = config[type] ?? config.update;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${bg} ${text}`}>
      {label}
    </span>
  );
}