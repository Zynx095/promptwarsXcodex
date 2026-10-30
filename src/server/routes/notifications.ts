import { Router } from 'express';
import type { AppContext } from '../context';
import { param } from '../http';
import { requireUser } from '../auth/session';
import { requireOrg } from '../repositories/orgs';
import { listUserNotifications, markAllNotificationsRead, markNotificationRead } from '../repositories/notifications';

export function notificationRoutes(ctx: AppContext): Router {
  const r = Router();
  const session = (req: Parameters<typeof requireUser>[0]) => {
    const user = requireUser(req);
    const org = requireOrg(ctx.db, user.orgId);
    return { user, org };
  };

  r.get('/notifications/mine', (req, res) => {
    const { user, org } = session(req);
    const result = listUserNotifications(ctx.db, org.id, user.id);
    res.json(result);
  });

  r.post('/notifications/:id/read', (req, res) => {
    const { user, org } = session(req);
    const id = param(req, 'id');
    const ok = markNotificationRead(ctx.db, org.id, user.id, id);
    res.json({ ok });
  });

  r.post('/notifications/read-all', (req, res) => {
    const { user, org } = session(req);
    const markedCount = markAllNotificationsRead(ctx.db, org.id, user.id);
    res.json({ ok: true, markedCount });
  });

  return r;
}
