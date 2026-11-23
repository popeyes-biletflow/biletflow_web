import type { ReactNode } from 'react';

// карточка для страниц входа / регистрации / пароля
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-800">{title}</h1>
        {children}
      </div>
    </main>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}

export function Field(props: FieldProps) {
  return (
    <div>
      <label htmlFor={props.id} className="mb-1 block text-sm font-medium text-gray-700">{props.label}</label>
      <input
        id={props.id}
        type={props.type || 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      {props.hint && <p className="mt-1 text-xs text-gray-500">{props.hint}</p>}
    </div>
  );
}
