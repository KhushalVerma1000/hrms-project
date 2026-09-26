import { logoutAction } from './logout-action';

export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className={
          className ??
          'flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-red-400 transition-colors'
        }
      >
        <span aria-hidden="true">⏻</span>
        <span>Log out</span>
      </button>
    </form>
  );
}
