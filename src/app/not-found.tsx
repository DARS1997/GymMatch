import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h2 className="text-2xl font-bold text-slate-100 mb-2">Seite nicht gefunden</h2>
      <p className="text-slate-400 mb-6">Die angeforderte Seite existiert nicht.</p>
      <Link
        href="/"
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
      >
        Zurück zur Startseite
      </Link>
    </div>
  );
}
