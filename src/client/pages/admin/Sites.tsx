import { useState, type FormEvent } from 'react';
import { MapPin, Plus, Check, X, Search } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { ErrorBox, Loading } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import type { SiteDTO } from '../../../shared/types';

export function AdminSites() {
  const { data, loading, error, reload } = useApi<{ items: SiteDTO[] }>('/admin/sites');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useI18n();

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
      setName('');
      setCode('');
      setAddress('');
      setShowAddModal(false);
      reload();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Failed to create site.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(site: SiteDTO) {
    try {
      await api(`/admin/sites/${site.id}/status`, {
        method: 'PATCH',
        body: { active: !site.active },
      });
      reload();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update site status.');
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const sites = data?.items ?? [];
  const filtered = sites.filter((s) => {
    const matchesText =
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.code.toLowerCase().includes(filter.toLowerCase()) ||
      s.address.toLowerCase().includes(filter.toLowerCase());
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' && s.active) || (statusFilter === 'inactive' && !s.active);
    return matchesText && matchesStatus;
  });

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('sites.title') || 'Sites & Locations'}</h1>
          <p className="page-subtitle">{t('sites.subtitle') || 'Manage physical worksites, job yards, and campus facilities across your organization.'}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus className="icon-sm" aria-hidden="true" />
          <span>{t('sites.addSite') || 'Add Site'}</span>
        </button>
      </div>

      <div className="card-glass filter-bar">
        <div className="search-input-wrapper">
          <Search className="search-icon" aria-hidden="true" />
          <input
            type="search"
            className="input search-input"
            placeholder={t('sites.searchPlaceholder') || 'Search by site name, code or address...'}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="filter-pill-group">
          <button type="button" className={`filter-pill ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
            All ({sites.length})
          </button>
          <button type="button" className={`filter-pill ${statusFilter === 'active' ? 'active' : ''}`} onClick={() => setStatusFilter('active')}>
            Active ({sites.filter((s) => s.active).length})
          </button>
          <button type="button" className={`filter-pill ${statusFilter === 'inactive' ? 'active' : ''}`} onClick={() => setStatusFilter('inactive')}>
            Inactive ({sites.filter((s) => !s.active).length})
          </button>
        </div>
      </div>

      <div className="card-glass table-responsive">
        <table className="table" aria-label="Sites roster">
          <thead>
            <tr>
              <th scope="col">Site Code</th>
              <th scope="col">Name & Location</th>
              <th scope="col">Address</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-muted p-4">
                  No matching sites found.
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="badge badge-code">{s.code}</span>
                  </td>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td className="text-muted">
                    <span className="site-address-cell">
                      <MapPin className="icon-xs inline-icon" aria-hidden="true" />
                      {s.address || '—'}
                    </span>
                  </td>
                  <td>{s.active ? <span className="badge badge-success">Active</span> : <span className="badge badge-muted">Inactive</span>}</td>
                  <td className="text-right">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleToggleStatus(s)}>
                      {s.active ? (
                        <>
                          <X className="icon-xs" aria-hidden="true" />
                          <span>Deactivate</span>
                        </>
                      ) : (
                        <>
                          <Check className="icon-xs" aria-hidden="true" />
                          <span>Activate</span>
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-dialog card-glass">
            <div className="modal-header">
              <h2 id="modal-title" className="h2">
                {t('sites.addSite') || 'Add New Site'}
              </h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(false)} aria-label="Close">
                <X className="icon-sm" aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleAddSite}>
              <div className="modal-body">
                {formError && <div className="banner banner-danger mb-3">{formError}</div>}
                <div className="field">
                  <label htmlFor="site-name" className="label">
                    Site Name *
                  </label>
                  <input
                    id="site-name"
                    type="text"
                    className="input"
                    required
                    placeholder="e.g. Pier 42 Casting Yard"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="site-code" className="label">
                    Site Code (2-10 alphanumeric characters) *
                  </label>
                  <input
                    id="site-code"
                    type="text"
                    className="input"
                    required
                    maxLength={10}
                    placeholder="e.g. P42CY"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                  <small className="help-text">Unique identifier used on shift records and safety incident tracking.</small>
                </div>
                <div className="field">
                  <label htmlFor="site-address" className="label">
                    Address / Physical Location
                  </label>
                  <input
                    id="site-address"
                    type="text"
                    className="input"
                    placeholder="e.g. Outer Ring Road, Bengaluru"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim() || !code.trim()}>
                  {submitting ? 'Creating...' : 'Create Site'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
