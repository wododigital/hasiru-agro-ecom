import { Button } from '@ecomkit/ui';
import { authMessages } from '../messages';
import { signOutAction } from '../server/actions';

/** A plain form post, so signing out works without JS. */
export function SignOutForm({ next = '/', label = authMessages.account.signOut }: { next?: string; label?: string }) {
  return (
    <form action={signOutAction}>
      <input type="hidden" name="next" value={next} />
      <Button type="submit" variant="outline" size="sm" data-cta="account-sign-out">
        {label}
      </Button>
    </form>
  );
}
