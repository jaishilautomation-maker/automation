"use client";

// =============================================================================
// Admin — User Management
//
// Available to: company_admin, factory_admin
//
// Features:
//   - View all users with Name, Phone, Role
//   - Add User (phone + name + role)
//   - Edit User (name, phone, role)
//   - Delete User (removes from DB + auth — they can no longer log in)
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase-browser";
import type { AppRole } from "@/lib/types";

interface UserRow {
  id:           string;
  full_name:    string;
  phone_number: string | null;
  role:         string | null;
  factory_id:   string | null;
  created_at:   string;
}

const ALL_ROLES: AppRole[] = [
  "company_admin",
  "factory_admin",
  "lab_manager",
  "chemist",
  "production_incharge",
  "operator",
  "stores",
  "viewer",
];

const ROLE_LABEL: Record<AppRole, string> = {
  company_admin:      "Company Admin",
  factory_admin:      "Factory Admin",
  lab_manager:        "Lab Manager",
  chemist:            "Chemist / Lab",
  production_incharge:"Production Incharge",
  operator:           "Operator",
  stores:             "Stores",
  viewer:             "Viewer",
};

const ROLE_COLOR: Record<string, { bg: string; color: string }> = {
  company_admin:      { bg: "#1a237e", color: "#fff" },
  factory_admin:      { bg: "#283593", color: "#fff" },
  lab_manager:        { bg: "#1b5e20", color: "#fff" },
  chemist:            { bg: "#2e7d32", color: "#fff" },
  production_incharge:{ bg: "#bf360c", color: "#fff" },
  operator:           { bg: "#e65100", color: "#fff" },
  stores:             { bg: "#4a148c", color: "#fff" },
  viewer:             { bg: "#546e7a", color: "#fff" },
};

type Mode = "list" | "add" | "edit";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function AdminPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();

  const [users, setUsers]         = useState<UserRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [mode, setMode]           = useState<Mode>("list");
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);

  // Form state
  const [formName,  setFormName]  = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formRole,  setFormRole]  = useState<AppRole>("operator");

  // Guard — only admins
  useEffect(() => {
    if (authLoading) return;
    const role = profile?.role;
    if (role !== "company_admin" && role !== "factory_admin") {
      router.replace("/select-module");
    }
  }, [authLoading, profile, router]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/admin/users", {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load users");
      const { users: data } = await res.json() as { users: UserRow[] };
      setUsers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3500);
  };

  const openAdd = () => {
    setFormName(""); setFormPhone(""); setFormRole("operator");
    setEditTarget(null); setError(null); setMode("add");
  };

  const openEdit = (u: UserRow) => {
    setFormName(u.full_name);
    setFormPhone(u.phone_number ?? "");
    setFormRole((u.role as AppRole) ?? "operator");
    setEditTarget(u); setError(null); setMode("edit");
  };

  const cancelForm = () => { setMode("list"); setError(null); setEditTarget(null); };

  // ── Add user ───────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!formName.trim())  { setError("Name is required."); return; }
    if (!formPhone.trim()) { setError("Phone number is required."); return; }
    let phone = formPhone.trim();
    if (!phone.startsWith("+")) phone = "+91" + phone.replace(/^0/, "");

    setSubmitting(true); setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ full_name: formName.trim(), phone_number: phone, role: formRole }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add user");
      showSuccess(`User "${formName.trim()}" added successfully.`);
      setMode("list");
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSubmitting(false); }
  };

  // ── Edit user ──────────────────────────────────────────────────────────────
  const handleEdit = async () => {
    if (!editTarget) return;
    if (!formName.trim()) { setError("Name is required."); return; }

    let phone = formPhone.trim();
    if (phone && !phone.startsWith("+")) phone = "+91" + phone.replace(/^0/, "");

    setSubmitting(true); setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          userId:       editTarget.id,
          full_name:    formName.trim(),
          phone_number: phone || undefined,
          role:         formRole,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update user");
      showSuccess(`User "${formName.trim()}" updated.`);
      setMode("list");
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSubmitting(false); }
  };

  // ── Delete user ────────────────────────────────────────────────────────────
  const handleDelete = async (u: UserRow) => {
    if (u.id === profile?.id) { setError("You cannot delete your own account."); return; }
    setSubmitting(true); setError(null); setConfirmDelete(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ userId: u.id }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete user");
      showSuccess(`User "${u.full_name}" deleted.`);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSubmitting(false); }
  };

  if (authLoading) return <div className="empty">Loading…</div>;
  if (profile?.role !== "company_admin" && profile?.role !== "factory_admin") return null;

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const matchSearch = search.trim() === "" ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (u.phone_number ?? "").includes(search) ||
      (u.role ?? "").toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === "all" || u.role === filterRole;
    return matchSearch && matchRole;
  });

  // ── Form view ──────────────────────────────────────────────────────────────
  if (mode === "add" || mode === "edit") {
    const isAdd = mode === "add";
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 4px" }}>
        <button className="back-link" type="button" onClick={cancelForm}>
          ← Back to User List
        </button>

        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginBottom: 16 }}>
            {isAdd ? "Add New User" : `Edit User — ${editTarget?.full_name}`}
          </h3>

          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 14,
              background: "var(--warn-soft)", color: "var(--warn)",
              fontSize: 13, fontWeight: 600, border: "1px solid var(--warn)",
            }}>
              {error}
            </div>
          )}

          <label>Full Name *</label>
          <input
            type="text"
            placeholder="e.g. Ramesh Kumar"
            value={formName}
            onChange={e => setFormName(e.target.value)}
          />

          <label style={{ marginTop: 12 }}>
            Phone Number * {isAdd && <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>(E.164 or 10-digit India)</span>}
          </label>
          <input
            type="tel"
            placeholder="e.g. +919876543210 or 9876543210"
            value={formPhone}
            onChange={e => setFormPhone(e.target.value)}
          />
          {isAdd && (
            <div className="field-hint" style={{ marginTop: 4 }}>
              The user will log in using this phone number via WhatsApp OTP.
            </div>
          )}

          <label style={{ marginTop: 12 }}>Role *</label>
          <select value={formRole} onChange={e => setFormRole(e.target.value as AppRole)}>
            {ALL_ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <div className="field-hint" style={{ marginTop: 4 }}>
            <b>company_admin / factory_admin</b> — full system access · <b>lab_manager / chemist</b> — Lab QC ·
            <b> production_incharge / operator</b> — Job Cards · <b>stores</b> — Stores module · <b>viewer</b> — read only
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "auto", padding: "10px 24px", marginTop: 0 }}
              disabled={submitting}
              onClick={isAdd ? handleAdd : handleEdit}>
              {submitting ? "Saving..." : isAdd ? "Add User" : "Save Changes"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "auto", padding: "10px 18px", marginTop: 0 }}
              onClick={cancelForm}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>User Management</h2>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
            {users.length} user{users.length !== 1 ? "s" : ""} in the system
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "auto", padding: "10px 20px", marginTop: 0 }}
          onClick={openAdd}>
          + Add User
        </button>
      </div>

      {/* Success banner */}
      {success && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 14,
          background: "var(--ok-soft)", color: "var(--ok)",
          fontSize: 13, fontWeight: 600, border: "1px solid var(--ok)",
        }}>
          ✓ {success}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 14,
          background: "var(--warn-soft)", color: "var(--warn)",
          fontSize: 13, fontWeight: 600, border: "1px solid var(--warn)",
        }}>
          {error}
          <button onClick={() => setError(null)} style={{
            marginLeft: 10, background: "none", border: "none",
            cursor: "pointer", color: "var(--warn)", fontWeight: 700,
          }}>✕</button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{
          padding: "14px 16px", borderRadius: 10, marginBottom: 16,
          background: "var(--warn-soft)", border: "2px solid var(--warn)",
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--warn)", marginBottom: 8 }}>
            Delete &quot;{confirmDelete.full_name}&quot;?
          </div>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            This will permanently remove the user from the system.
            They will no longer be able to log in.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "auto", padding: "8px 18px", marginTop: 0, background: "var(--warn)" }}
              disabled={submitting}
              onClick={() => handleDelete(confirmDelete)}>
              {submitting ? "Deleting..." : "Yes, Delete"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "auto", padding: "8px 14px", marginTop: 0 }}
              onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search name, phone, role..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: "7px 10px", fontSize: 12,
            border: "1px solid var(--line)", borderRadius: 6, width: 220 }}
        />
        <select
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
          style={{ padding: "7px 10px", fontSize: 12,
            border: "1px solid var(--line)", borderRadius: 6 }}>
          <option value="all">All Roles</option>
          {ALL_ROLES.map(r => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: "auto", padding: "7px 14px", marginTop: 0, fontSize: 12 }}
          onClick={loadUsers}>
          Refresh
        </button>
      </div>

      {/* User list */}
      {loading ? (
        <div className="empty">Loading users...</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No users found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="dash" style={{ minWidth: 580 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Added</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const rc = ROLE_COLOR[u.role ?? "viewer"] ?? { bg: "#546e7a", color: "#fff" };
                const isSelf = u.id === profile?.id;
                return (
                  <tr key={u.id} style={{ background: isSelf ? "rgba(27,94,32,.04)" : undefined }}>
                    <td style={{ fontWeight: 600 }}>
                      {u.full_name}
                      {isSelf && (
                        <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px",
                          borderRadius: 6, background: "var(--ok-soft)", color: "var(--ok)",
                          fontWeight: 700 }}>
                          You
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 13, fontFamily: "monospace" }}>
                      {u.phone_number ?? "—"}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px",
                        borderRadius: 8, background: rc.bg, color: rc.color,
                        whiteSpace: "nowrap",
                      }}>
                        {ROLE_LABEL[u.role as AppRole] ?? u.role ?? "—"}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                      {fmtDate(u.created_at)}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        style={{
                          padding: "4px 12px", fontSize: 12, fontWeight: 700,
                          border: "1px solid var(--clay)", borderRadius: 6,
                          background: "var(--clay-soft)", color: "var(--clay)",
                          cursor: "pointer", marginRight: 6,
                        }}>
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => { setConfirmDelete(u); setError(null); }}
                        style={{
                          padding: "4px 12px", fontSize: 12, fontWeight: 700,
                          border: "1px solid " + (isSelf ? "var(--line)" : "var(--warn)"),
                          borderRadius: 6,
                          background: isSelf ? "var(--line)" : "var(--warn-soft)",
                          color: isSelf ? "var(--ink-soft)" : "var(--warn)",
                          cursor: isSelf ? "not-allowed" : "pointer",
                        }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 16 }}>
        Showing {filtered.length} of {users.length} users.
        Deleted users are immediately removed from the system and cannot log in.
      </div>
    </div>
  );
}
