'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, Check, Copy, Mail, Plus, UserMinus, Users } from 'lucide-react';
import { toast } from 'sonner';

import SettingsPageShell from '@/components/settings/SettingsPageShell';
import SettingsEmptyState from '@/components/settings/SettingsEmptyState';
import SettingsNotice from '@/components/settings/SettingsNotice';
import SettingsSection from '@/components/settings/SettingsSection';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientDictionary } from '@/i18n/client';
import { replaceOrgInPath } from '@/lib/orgPath';
import { formatLocalDate } from '@/lib/dateFormat';

type OrgRole = 'owner' | 'admin' | 'reviewer' | 'member';

interface Organization {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  owner_id: string | null;
  created_at: string;
}

interface OrgMember {
  user_id: string;
  role: OrgRole;
  status: 'active' | 'invited' | 'suspended';
  created_at: string;
  email?: string | null;
}

interface OrgInvite {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

const roleBadgeVariant: Record<OrgRole, 'accent' | 'secondary' | 'outline' | 'muted'> = {
  owner: 'accent',
  admin: 'secondary',
  reviewer: 'outline',
  member: 'muted',
};

function OrganizationsSkeleton() {
  return (
    <SettingsPageShell
      title={<Skeleton className="h-8 w-40 max-w-full" />}
      description={<Skeleton className="h-4 w-80 max-w-full" />}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-8 w-28 rounded-[6px]" />
          </div>
          <div className="space-y-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-56" />
            </div>
            <Skeleton className="h-5 w-16 rounded-[4px]" />
          </div>
          <div className="space-y-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-8 w-40" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="h-5 w-16 rounded-[4px]" />
          </div>
          <div className="space-y-2 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] p-4">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </div>
    </SettingsPageShell>
  );
}

export default function OrganizationsScreen() {
  const dict = useClientDictionary();
  const i18n = dict.settings.organizationsPage;
  const router = useRouter();
  const pathname = usePathname();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<OrgMember | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const roleLabels: Record<OrgRole, string> = {
    owner: i18n.roleOwner,
    admin: i18n.roleAdmin,
    reviewer: i18n.roleReviewer,
    member: i18n.roleMember,
  };

  const memberStatusLabels: Record<OrgMember['status'], string> = {
    active: i18n.statusActive,
    invited: i18n.statusInvited,
    suspended: i18n.statusSuspended,
  };

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCurrentUserId(data?.user?.id ?? null))
      .catch(() => setCurrentUserId(null));
  }, []);

  const activeOrg = useMemo(() => orgs.find((org) => org.id === activeOrgId) ?? orgs[0], [orgs, activeOrgId]);

  const currentUserRole = useMemo(() => {
    if (!currentUserId) return null;
    return members.find((member) => member.user_id === currentUserId)?.role ?? null;
  }, [members, currentUserId]);

  const canManageMembers = currentUserRole === 'owner' || currentUserRole === 'admin';

  const loadMembers = useCallback(
    async (orgId: string) => {
      setMembersLoading(true);
      try {
        const res = await fetch(`/api/orgs/${orgId}/members`);
        if (!res.ok) throw new Error(i18n.loadMembersFailed);
        const data = await res.json();
        setMembers(Array.isArray(data) ? data : []);
      } catch {
        toast.error(i18n.loadMembersFailed);
      } finally {
        setMembersLoading(false);
      }
    },
    [i18n.loadMembersFailed],
  );

  const loadInvites = useCallback(
    async (orgId: string) => {
      setInvitesLoading(true);
      try {
        const res = await fetch(`/api/orgs/${orgId}/invites`);
        if (!res.ok) throw new Error(i18n.loadInvitesFailed);
        const data = await res.json();
        setInvites(Array.isArray(data) ? data : []);
      } catch {
        toast.error(i18n.loadInvitesFailed);
      } finally {
        setInvitesLoading(false);
      }
    },
    [i18n.loadInvitesFailed],
  );

  useEffect(() => {
    let alive = true;

    async function loadOrgs() {
      setLoading(true);
      try {
        const [orgRes, activeRes] = await Promise.all([fetch('/api/orgs'), fetch('/api/orgs/active')]);
        const orgData = orgRes.ok ? await orgRes.json() : [];
        const activeData = activeRes.ok ? await activeRes.json() : null;

        if (!alive) return;
        const safeOrgs = Array.isArray(orgData) ? orgData : [];
        setOrgs(safeOrgs);
        setActiveOrgId(activeData?.orgId ?? safeOrgs[0]?.id ?? null);
      } catch {
        if (alive) toast.error(i18n.loadOrganizationsFailed);
      } finally {
        if (alive) setLoading(false);
      }
    }

    void loadOrgs();
    return () => {
      alive = false;
    };
  }, [i18n.loadOrganizationsFailed]);

  useEffect(() => {
    if (!activeOrgId) return;
    void loadMembers(activeOrgId);
    void loadInvites(activeOrgId);
  }, [activeOrgId, loadInvites, loadMembers]);

  async function setActiveOrg(orgId: string) {
    if (orgId === activeOrgId) return;
    try {
      const res = await fetch('/api/orgs/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) throw new Error(i18n.switchOrganizationFailed);
      setActiveOrgId(orgId);
      router.push(replaceOrgInPath(pathname, orgId));
      router.refresh();
    } catch {
      toast.error(i18n.switchOrganizationFailed);
    }
  }

  async function handleCreateOrg() {
    const name = newOrgName.trim();
    const slug = newOrgSlug.trim();
    if (!name) {
      toast.error(i18n.organizationNameRequired);
      return;
    }

    try {
      const body = slug ? { name, slug } : { name };
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || i18n.createOrganizationFailed);
      }
      const org = await res.json();
      setOrgs((prev) => [org, ...prev]);
      setCreateOpen(false);
      setNewOrgName('');
      setNewOrgSlug('');
      await setActiveOrg(org.id);
      toast.success(i18n.createOrganizationSuccess);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.createOrganizationFailed);
    }
  }

  async function handleInvite() {
    if (!activeOrgId) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error(i18n.inviteEmailRequired);
      return;
    }

    try {
      const res = await fetch(`/api/orgs/${activeOrgId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || i18n.sendInviteFailed);
      }
      const invite = await res.json();
      setInvites((prev) => [invite, ...prev]);
      setInviteEmail('');
      toast.success(i18n.sendInviteSuccess);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.sendInviteFailed);
    }
  }

  async function handleCopyInvite(invite: OrgInvite) {
    const url = `${window.location.origin}/invite/${invite.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(i18n.copyInviteSuccess);
    } catch {
      toast.error(i18n.copyInviteFailed);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!activeOrgId) return;
    try {
      const res = await fetch(`/api/orgs/${activeOrgId}/invites/${inviteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(i18n.revokeInviteFailed);
      setInvites((prev) => prev.filter((invite) => invite.id !== inviteId));
      toast.success(i18n.revokeInviteSuccess);
    } catch {
      toast.error(i18n.revokeInviteFailed);
    }
  }

  async function handleRoleChange(member: OrgMember, role: OrgRole) {
    if (!activeOrgId) return;
    try {
      const res = await fetch(`/api/orgs/${activeOrgId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.user_id, role }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || i18n.updateMemberRoleFailed);
      }
      const updated = await res.json();
      setMembers((prev) => prev.map((item) => (item.user_id === member.user_id ? { ...item, role: updated.role } : item)));
      toast.success(i18n.updateMemberRoleSuccess);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.updateMemberRoleFailed);
    }
  }

  async function handleRemoveMember(member: OrgMember) {
    if (!activeOrgId) return;
    setRemovingMemberId(member.user_id);
    try {
      const res = await fetch(`/api/orgs/${activeOrgId}/members/${member.user_id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || i18n.removeMemberFailed);
      }
      setMembers((prev) => prev.filter((item) => item.user_id !== member.user_id));
      toast.success(i18n.removeMemberSuccess);
      setMemberToRemove(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.removeMemberFailed);
    } finally {
      setRemovingMemberId(null);
    }
  }

  if (loading) {
    return <OrganizationsSkeleton />;
  }

  return (
    <>
      <SettingsPageShell title={i18n.title} description={i18n.description}>
        <div className="space-y-6">
          <SettingsSection
            title={i18n.yourOrganizationsTitle}
            description={i18n.totalCount.replace('{{count}}', String(orgs.length))}
            action={
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="size-4" />
                    {i18n.newOrganization}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{i18n.createDialogTitle}</DialogTitle>
                    <DialogDescription>{i18n.createDialogDescription}</DialogDescription>
                  </DialogHeader>
                  <DialogBody className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[12px] font-medium">{dict.common.name}</label>
                      <Input
                        value={newOrgName}
                        onChange={(e) => setNewOrgName(e.target.value)}
                        placeholder={i18n.organizationNamePlaceholder}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[12px] font-medium">{i18n.slugOptionalLabel}</label>
                      <Input
                        value={newOrgSlug}
                        onChange={(e) => setNewOrgSlug(e.target.value)}
                        placeholder={i18n.slugPlaceholder}
                      />
                    </div>
                  </DialogBody>
                  <DialogFooter>
                    <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                      {dict.common.cancel}
                    </Button>
                    <Button onClick={handleCreateOrg}>{i18n.createAction}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            }
          >
            {orgs.length === 0 ? (
              <SettingsEmptyState
                title={i18n.noOrganizations}
                description={i18n.noOrganizationsDescription}
                icon={<Building2 className="size-4" />}
                action={
                  <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
                    <Plus className="size-4" />
                    {i18n.newOrganization}
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-[8px] border border-[hsl(var(--ds-border-1))]">
                <div className="hidden md:grid grid-cols-[1fr_140px_160px] px-4 py-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                  <span>{dict.common.name}</span>
                  <span>{i18n.typeLabel}</span>
                  <span className="text-right">{dict.common.status}</span>
                </div>
                <div className="divide-y divide-[hsl(var(--ds-border-1))]">
                  {orgs.map((org) => {
                    const isActive = org.id === activeOrg?.id;
                    return (
                      <div
                        key={org.id}
                        className="flex flex-col gap-2 px-4 py-3 md:grid md:grid-cols-[1fr_140px_160px] md:items-center"
                      >
                        <div>
                          <div className="text-[13px] font-medium">{org.name}</div>
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{org.slug}</div>
                        </div>
                        <div>
                          <Badge variant={org.is_personal ? 'secondary' : 'outline'}>
                            {org.is_personal ? i18n.personalType : i18n.teamType}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between gap-2 md:justify-end">
                          {isActive ? (
                            <Badge variant="accent" size="sm" className="gap-1">
                              <Check className="size-3" />
                              {i18n.activeBadge}
                            </Badge>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setActiveOrg(org.id)}>
                              {i18n.switchAction}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </SettingsSection>

          <SettingsSection
            title={i18n.membersTitle}
            description={activeOrg ? i18n.workspaceLabel.replace('{{name}}', activeOrg.name) : i18n.selectOrganization}
            action={<Badge variant="muted">{members.length}</Badge>}
          >
            <div className="overflow-hidden rounded-[8px] border border-[hsl(var(--ds-border-1))]">
              <div className="hidden md:grid grid-cols-[1fr_160px_120px_120px] px-4 py-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                <span>{i18n.userLabel}</span>
                <span>{i18n.roleLabel}</span>
                <span>{dict.common.status}</span>
                <span className="text-right">{dict.common.actions}</span>
              </div>
              <div className="divide-y divide-[hsl(var(--ds-border-1))]">
                {membersLoading ? (
                  <div className="px-4 py-4 space-y-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div
                        key={`member-skeleton-${index}`}
                        className="flex flex-col gap-2 md:grid md:grid-cols-[1fr_160px_120px_120px] md:items-center"
                      >
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                        <Skeleton className="h-7 w-24 rounded-[6px]" />
                        <Skeleton className="h-5 w-16 rounded-[4px]" />
                        <div className="flex justify-end">
                          <Skeleton className="h-7 w-20 rounded-[6px]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : members.length === 0 ? (
                  <div className="p-4">
                    <SettingsEmptyState
                      title={i18n.noMembers}
                      description={i18n.noMembersDescription}
                      icon={<Users className="size-4" />}
                    />
                  </div>
                ) : (
                  members.map((member) => {
                    const isSelf = member.user_id === currentUserId;
                    const canEditRole =
                      canManageMembers &&
                      !(member.role === 'owner' && currentUserRole !== 'owner') &&
                      !(isSelf && member.role === 'owner');
                    const canRemove =
                      canManageMembers &&
                      !isSelf &&
                      !(member.role === 'owner' && currentUserRole !== 'owner');

                    return (
                      <div
                        key={member.user_id}
                        className="flex flex-col gap-3 px-4 py-3 md:grid md:grid-cols-[1fr_160px_120px_120px] md:items-center"
                      >
                        <div>
                          <div className="text-[13px] font-medium">
                            {member.email ?? member.user_id}
                            {isSelf && (
                              <span className="text-[12px] text-[hsl(var(--ds-text-2))]"> ({i18n.youLabel})</span>
                            )}
                          </div>
                          {member.email && (
                            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{member.user_id}</div>
                          )}
                        </div>
                        <div>
                          {canEditRole ? (
                            <Select value={member.role} onValueChange={(value) => handleRoleChange(member, value as OrgRole)}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(roleLabels).map(([key, label]) => (
                                  <SelectItem key={key} value={key}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant={roleBadgeVariant[member.role]}>{roleLabels[member.role]}</Badge>
                          )}
                        </div>
                        <div>
                          <Badge variant={member.status === 'active' ? 'success' : 'muted'}>
                            {memberStatusLabels[member.status]}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 md:justify-end">
                          {canRemove ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setMemberToRemove(member)}
                              disabled={removingMemberId === member.user_id}
                              className="gap-1"
                            >
                              <UserMinus className="size-3.5" />
                              {removingMemberId === member.user_id ? i18n.removing : i18n.removeAction}
                            </Button>
                          ) : (
                            <span className="text-[12px] text-[hsl(var(--ds-text-2))]">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            title={i18n.invitesTitle}
            description={i18n.invitesDescription.replace('{{orgName}}', activeOrg?.name ?? i18n.yourOrganization)}
            action={<Badge variant="muted">{invites.length}</Badge>}
          >
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
                  <Input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder={i18n.inviteEmailPlaceholder}
                  />
                  <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as OrgRole)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(roleLabels).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleInvite} disabled={!canManageMembers}>
                    {i18n.sendInviteAction}
                  </Button>
                </div>
                {!canManageMembers && (
                  <SettingsNotice
                    variant="info"
                    description={i18n.invitePermissionHint}
                  />
                )}
              </CardContent>
            </Card>

            <div className="overflow-hidden rounded-[8px] border border-[hsl(var(--ds-border-1))]">
              <div className="hidden md:grid grid-cols-[1fr_120px_160px_120px] px-4 py-2 text-[12px] text-[hsl(var(--ds-text-2))]">
                <span>{dict.auth.email}</span>
                <span>{i18n.roleLabel}</span>
                <span>{i18n.expiresLabel}</span>
                <span className="text-right">{dict.common.actions}</span>
              </div>
              <div className="divide-y divide-[hsl(var(--ds-border-1))]">
                {invitesLoading ? (
                  <div className="px-4 py-4 space-y-3">
                    {Array.from({ length: 2 }).map((_, index) => (
                      <div
                        key={`invite-skeleton-${index}`}
                        className="flex flex-col gap-2 md:grid md:grid-cols-[1fr_120px_160px_120px] md:items-center"
                      >
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-44" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                        <Skeleton className="h-5 w-16 rounded-[4px]" />
                        <Skeleton className="h-3 w-20" />
                        <div className="flex justify-end">
                          <Skeleton className="h-7 w-24 rounded-[6px]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : invites.length === 0 ? (
                  <div className="p-4">
                    <SettingsEmptyState
                      title={i18n.noInvites}
                      description={i18n.noInvitesDescription}
                      icon={<Mail className="size-4" />}
                    />
                  </div>
                ) : (
                  invites.map((invite) => {
                    const expired = new Date(invite.expires_at).getTime() < Date.now();
                    return (
                      <div
                        key={invite.id}
                        className="flex flex-col gap-2 px-4 py-3 md:grid md:grid-cols-[1fr_120px_160px_120px] md:items-center"
                      >
                        <div>
                          <div className="text-[13px] font-medium">{invite.email}</div>
                          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                            {invite.accepted_at
                              ? i18n.inviteAccepted
                              : expired
                                ? i18n.inviteExpired
                                : i18n.invitePending}
                          </div>
                        </div>
                        <div>
                          <Badge variant={roleBadgeVariant[invite.role]}>{roleLabels[invite.role]}</Badge>
                        </div>
                        <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
                          {formatLocalDate(invite.expires_at)}
                        </div>
                        <div className="flex items-center gap-2 md:justify-end">
                          <Button size="sm" variant="ghost" onClick={() => handleCopyInvite(invite)} className="gap-1">
                            <Copy className="size-3.5" />
                            {dict.common.copy}
                          </Button>
                          {canManageMembers && !invite.accepted_at && (
                            <Button size="sm" variant="ghost" onClick={() => handleRevokeInvite(invite.id)}>
                              {i18n.revokeAction}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </SettingsSection>
        </div>
      </SettingsPageShell>

      <ConfirmDialog
        open={memberToRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removingMemberId) setMemberToRemove(null);
        }}
        title={i18n.removeMemberDialogTitle}
        description={i18n.removeMemberDialogDescription.replace(
          '{{target}}',
          memberToRemove?.email ?? memberToRemove?.user_id ?? '',
        )}
        confirmLabel={removingMemberId ? i18n.removing : i18n.removeAction}
        cancelLabel={dict.common.cancel}
        onConfirm={() => {
          if (!memberToRemove || removingMemberId) return;
          void handleRemoveMember(memberToRemove);
        }}
        loading={removingMemberId !== null}
        danger
      />
    </>
  );
}
