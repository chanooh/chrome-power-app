export type ProfileLeaseOwner = 'rpa' | 'recorder' | 'sync';

export interface ProfileLease {
  windowId: number;
  owner: ProfileLeaseOwner;
  token: string;
  acquiredAt: number;
}

class ProfileLeaseRegistry {
  private readonly leases = new Map<number, ProfileLease>();

  acquire(windowIds: number[], owner: ProfileLeaseOwner, token: string): ProfileLease[] {
    const uniqueIds = Array.from(new Set(windowIds));
    const conflicts = uniqueIds
      .map(windowId => this.leases.get(windowId))
      .filter((lease): lease is ProfileLease => !!lease && lease.token !== token);

    if (conflicts.length > 0) {
      const detail = conflicts.map(lease => `${lease.windowId} (${lease.owner})`).join(', ');
      throw new Error(`Profiles are already occupied: ${detail}`);
    }

    const acquiredAt = Date.now();
    return uniqueIds.map(windowId => {
      const lease = {windowId, owner, token, acquiredAt};
      this.leases.set(windowId, lease);
      return lease;
    });
  }

  release(token: string): void {
    for (const [windowId, lease] of this.leases) {
      if (lease.token === token) this.leases.delete(windowId);
    }
  }

  releaseWindow(windowId: number, token: string): void {
    if (this.leases.get(windowId)?.token === token) this.leases.delete(windowId);
  }

  get(windowId: number): ProfileLease | undefined {
    return this.leases.get(windowId);
  }

  clear(): void {
    this.leases.clear();
  }
}

export const profileLeaseRegistry = new ProfileLeaseRegistry();
