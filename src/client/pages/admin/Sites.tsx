import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { Async, Badge, Button, ConfirmDialog, Empty, Field, Notice, Page } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import type { SiteDTO } from '../../../shared/types';

type StatusFilter = 'all' | 'active' | 'inactive';

export function AdminSites() {
  const sitesState = useApi<{ items: SiteDTO[] }>('/admin/sites');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<SiteDTO | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);

  async function handleAddSite(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api('/admin/sites', {
        method: 'POST',
        body: {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          address: address.trim(),
        },
      });
      setMessage({ kind: 'success', text: `Site ${code.trim().toUpperCase()} was added.` });
      setName('');
      setCode('');
      setAddress('');
      setShowAddModal(false);
      sitesState.reload();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create site.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(site: SiteDTO) {
    setToggleBusy(true);
    try {
      await api(`/admin/sites/${site.id}/status`, {
        method: 'PATCH',
        body: { active: !site.active },
      });
      setMessage({ kind: 'success', text: `${site.name} is now ${site.active ? 'inactive' : 'active'}.` });
      sitesState.reload();
    } catch (err: unknown) {
      setMessage({ kind: 'warning', text: err instanceof Error ? err.message : 'Failed to update site status.' });
    } finally {
      setToggleBusy(false);
      setToggling(null);
    }
  }

  const sites = sitesState.data?.items ?? [];
  const counts: Record<StatusFilter, number> = {
    all: sites.length,
    active: sites.filter((s) => s.active).length,
    inactive: sites.filter((s) => !s.active).length,
  };

  return (
    <Page
      title="Sites & Locations"
      description="A reference list of the worksites, yards and campus buildings in your organisation. Shifts and reports are not linked to a site yet."
      actions={
        <Button variant="primary" onClick={() => setShowAddModal(true)} aria-haspopup="dialog">
          <Plus className="icon-sm" aria-hidden="true" />
          <span>Add site</span>
        </Button>
      }
    >
      <div aria-live="polite">{message ? <Notice kind={message.kind}>{message.text}</Notice> : null}</div>

      <div className="table-tools">
        <Field label="Search sites">
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name, code or address" />
        </Field>
        <div className="chip-filter" role="group" aria-label="Show sites">
          {(['all', 'active', 'inactive'] as const).map((f) => (
            <button key={f} type="button" className="chip-toggle" aria-pressed={statusFilter === f} onClick={() => setStatusFilter(f)}>
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'} <span className="figure">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <Async state={sitesState}>
        {(d) => {
          const q = filter.toLowerCase();
          const filtered = d.items.filter((s) => {
            const matchesText = s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.address.toLowerCase().includes(q);
            const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' && s.active) || (statusFilter === 'inactive' && !s.active);
            return matchesText && matchesStatus;
          });
          return filtered.length === 0 ? (
            <Empty>No matching sites found.</Empty>
          ) : (
            <div className="table-wrap">
              <table aria-label="Sites">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Address</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="code-chip">{s.code}</span>
                      </td>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{s.address || <span className="muted">—</span>}</td>
                      <td>{s.active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                      <td className="cell-end">
                        <Button variant="secondary" className="btn btn-secondary btn-sm" onClick={() => setToggling(s)} aria-haspopup="dialog">
                          {s.active ? 'Deactivate' : 'Activate'}
                          <span className="visually-hidden"> {s.name}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Async>

      <ConfirmDialog
        isOpen={toggling !== null}
        title={toggling?.active ? `Deactivate ${toggling.name}?` : `Activate ${toggling?.name ?? ''}?`}
        message={
          toggling?.active ? 'It will be marked inactive in this list. You can activate it again at any time.' : 'It will be marked active in this list again.'
        }
        confirmLabel={toggling?.active ? 'Deactivate' : 'Activate'}
        variant={toggling?.active ? 'danger' : 'primary'}
        busy={toggleBusy}
        onConfirm={() => toggling && void handleToggleStatus(toggling)}
        onCancel={() => setToggling(null)}
      />

      <Sheet
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add a site"
        dismissible={!submitting}
        footer={
          <div className="form-actions sheet-actions">
            <Button variant="quiet" onClick={() => setShowAddModal(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="add-site" busy={submitting} disabled={submitting || !name.trim() || !code.trim()}>
              Add site
            </Button>
          </div>
        }
      >
        <form id="add-site" onSubmit={handleAddSite} noValidate>
          {formError ? <Notice kind="warning">{formError}</Notice> : null}
          <Field label="Site name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Site code" hint="2 to 10 letters, numbers, hyphens or underscores, unique in your organisation.">
            <input type="text" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
          </Field>
          <Field label="Address" optional>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
          </Field>
        </form>
      </Sheet>
    </Page>
  );
}
