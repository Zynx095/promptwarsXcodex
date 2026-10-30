import type { Db } from '../db/db';
import type { NotificationDTO, NotificationType, NotificationsResponse } from '../../shared/types';
import { randomUUID } from 'node:crypto';

export interface NotificationInsert {
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  nowIso: string;
}

export function createNotification(db: Db, input: NotificationInsert): NotificationDTO {
  const id = `notif_${randomUUID()}`;
  db.run(
    `INSERT INTO notifications (id, org_id, user_id, type, title, body, link, read, created_at)
     VALUES (@id, @orgId, @userId, @type, @title, @body, @link, 0, @nowIso)`,
    {
      id,
      orgId: input.orgId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      nowIso: input.nowIso,
    },
  );

  return {
    id,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link,
    read: false,
    createdAt: input.nowIso,
  };
}

export function notifyAdmins(
  db: Db,
  input: {
    orgId: string;
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
    nowIso: string;
  },
): void {
  const admins = db.all<{ id: string }>(`SELECT id FROM users WHERE org_id = @orgId AND role = 'admin' AND active = 1`, { orgId: input.orgId });

  for (const admin of admins) {
    createNotification(db, {
      orgId: input.orgId,
      userId: admin.id,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      nowIso: input.nowIso,
    });
  }
}

export function listUserNotifications(db: Db, orgId: string, userId: string, limit = 50): NotificationsResponse {
  const rows = db.all<{
    id: string;
    type: NotificationType;
    title: string;
    body: string;
    link: string | null;
    read: number;
    created_at: string;
  }>(
    `SELECT id, type, title, body, link, read, created_at
     FROM notifications
     WHERE org_id = @orgId AND user_id = @userId
     ORDER BY created_at DESC
     LIMIT @limit`,
    { orgId, userId, limit },
  );

  const unreadCount =
    db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
     FROM notifications
     WHERE org_id = @orgId AND user_id = @userId AND read = 0`,
      { orgId, userId },
    )?.count ?? 0;

  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link ?? undefined,
      read: Boolean(r.read),
      createdAt: r.created_at,
    })),
    unreadCount,
  };
}

export function markNotificationRead(db: Db, orgId: string, userId: string, notificationId: string): boolean {
  const changes = db.run(
    `UPDATE notifications
     SET read = 1
     WHERE id = @notificationId AND org_id = @orgId AND user_id = @userId`,
    { notificationId, orgId, userId },
  );
  return changes > 0;
}

export function markAllNotificationsRead(db: Db, orgId: string, userId: string): number {
  return db.run(
    `UPDATE notifications
     SET read = 1
     WHERE org_id = @orgId AND user_id = @userId AND read = 0`,
    { orgId, userId },
  );
}
