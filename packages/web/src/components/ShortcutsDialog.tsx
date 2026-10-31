import { useStore } from '../store';
import { SHORTCUTS } from '../shortcuts';
import { Keys, Modal } from './ui';

export function ShortcutsDialog() {
  const openModal = useStore((s) => s.openModal);
  return (
    <Modal title="Keyboard shortcuts" description="Work without leaving the keyboard." onClose={() => openModal(null)} size="lg">
      <div className="grid gap-x-8 gap-y-6 px-5 pt-1 pb-5 sm:grid-cols-2">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3 className="mb-2 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{g.group}</h3>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {g.items.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-4 px-3.5 py-2 text-[13px] text-fg">
                  {s.label}
                  <Keys keys={s.keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
