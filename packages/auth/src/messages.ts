/**
 * Default copy for sign-in and the account shell. Brand-neutral; a host overrides through its own messages object.
 * Rules: no em dashes, plain words.
 */
const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));
const waitFor = (sec: number) => (minutes(sec) === 1 ? '1 minute' : `${minutes(sec)} minutes`);

export const authMessages = {
  login: {
    metaTitle: 'Sign in',
    title: 'Sign in',
    intro: 'Use your mobile number or email. We will send you a 6-digit code, no password needed.',
    identifierLabel: 'Mobile number or email',
    identifierPlaceholder: '98765 43210',
    identifierHelp: 'Codes for mobile numbers come on WhatsApp. Codes for email come by email.',
    sendCode: 'Send code',
    sending: 'Sending',
    codeLabel: '6-digit code',
    codeSentTo: (who: string) => `If ${who} can receive messages, a code is on its way. It works for 5 minutes.`,
    resent: 'A new code is on its way. Use the latest one.',
    verify: 'Sign in',
    verifying: 'Checking',
    resend: 'Send a new code',
    changeIdentifier: 'Use a different number or email',
    errors: {
      invalidIdentifier: 'Enter a 10-digit Indian mobile number or an email address.',
      invalidCode: 'That code did not work. Check it, or ask for a new one.',
      rateLimited: (sec: number) => `Too many tries. Please wait ${waitFor(sec)} and try again.`,
    },
  },
  account: {
    metaTitle: 'Your account',
    title: 'Your account',
    greeting: (name: string | null) => (name ? `Hello, ${name}` : 'Hello'),
    signedInAs: (who: string) => `Signed in as ${who}`,
    signOut: 'Sign out',
    navLabel: 'Account',
    /** Labels for account pages other modules add; a link shows only when its page exists. */
    links: {
      '/account': 'Overview',
      '/account/orders': 'Orders',
      '/account/profile': 'Profile',
      '/account/addresses': 'Addresses',
      '/account/land': 'My land',
      '/account/reviews': 'Reviews',
    } as Record<string, string>,
    loading: 'Loading your account',
  },
  staff: {
    metaTitle: 'Staff sign in',
    title: 'Staff sign in',
    email: 'Work email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in',
    secondFactorTitle: 'Enter your authenticator code',
    totpLabel: '6-digit code from your authenticator app',
    backupLabel: 'Backup code',
    useBackup: 'Use a backup code instead',
    useApp: 'Use the authenticator app instead',
    verify: 'Continue',
    enrolTitle: 'Set up two-step sign-in',
    enrolIntro: 'Staff accounts need an authenticator app (Google Authenticator, Microsoft Authenticator or similar). Confirm your password to start.',
    enrolStart: 'Start setup',
    enrolKeyIntro: 'Add this account to your authenticator app with the setup key below, or open the link on this phone.',
    enrolKey: 'Setup key',
    enrolOpenApp: 'Open in authenticator app',
    backupTitle: 'Backup codes',
    backupHelp: 'Each code works once if you lose your phone. Save them somewhere safe now; they are not shown again.',
    enrolConfirmLabel: 'Code from the app',
    enrolConfirm: 'Finish setup',
    inviteTitle: 'Set your password',
    inviteIntro: 'Choose a password with at least 12 characters. You will set up two-step sign-in next.',
    newPassword: 'New password',
    setPassword: 'Save password',
    inviteDone: 'Password saved. Sign in to continue.',
    errors: {
      invalid: 'That email and password do not match.',
      locked: (sec: number) => `Too many failed attempts. This account is locked for ${waitFor(sec)}.`,
      rateLimited: (sec: number) => `Too many attempts from this network. Please wait ${waitFor(sec)}.`,
      codeInvalid: 'That code did not work. Try the newest code from the app.',
      inviteInvalid: 'This invite link has expired or was already used, or the password is shorter than 12 characters.',
    },
  },
};

export type AuthMessages = typeof authMessages;
