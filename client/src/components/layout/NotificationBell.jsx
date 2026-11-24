import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import api from '../../api/client';
import { useSocketEvent } from '../../lib/socket';
import { timeAgo } from '../../lib/format';
import { cx } from '../ui';
import { toast } from '../../lib/alerts';

const DOT = { success: 'bg-emerald-500', warning: 'bg-amber-500', approval: 'bg-violet-500', scoring: 'bg-brand-500', info: 'bg-sky-500' };

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api
      .get('/notifications')
      .then(({ data }) => {
        setItems(data.items);
        setUnread(data.unread);
      })
      .catch(() => {});
  }, []);

  useEffect(load, [load]);
  useSocketEvent('notification', (n) => {
    setItems((list) => [n, ...list].slice(0, 50));
    setUnread((u) => u + 1);
    toast.info(n.title);
  });

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const openItem = async (n) => {
    if (!n.read) {
      api.patch(`/notifications/${n._id}/read`).catch(() => {});
      setItems((list) => list.map((x) => (x._id === n._id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    await api.patch('/notifications/read-all').catch(() => {});
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setUnread(0);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="relative inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Notifications">
        <Bell className="size-4.5" />
        {unread > 0 && <span className="absolute top-1 right-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">You’re all caught up.</p>
            ) : (
              items.map((n) => (
                <button key={n._id} type="button" onClick={() => openItem(n)} className={cx('flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50', !n.read && 'bg-brand-50/40')}>
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-slate-200' : DOT[n.type] || DOT.info)} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">{n.title}</span>
                    {n.message && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.message}</span>}
                    <span className="mt-1 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
