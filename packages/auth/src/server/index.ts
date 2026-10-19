import 'server-only';

// Public server API of @ecomkit/auth.
export { authOptions, getAuth, type Auth } from './auth';
export { configureAuth, clientIp, type AuthDeps } from './config';
export { sendOtp, verifyOtp, type SendOtpResult, type VerifyOtpResult } from './otp';
export {
  acceptInvite,
  beginTotpEnrolment,
  bootstrapOwner,
  confirmTotpEnrolment,
  ensureRolePermissions,
  getRoleMatrix,
  inviteStaff,
  listStaff,
  resendInvite,
  setRolePermissions,
  setStaffDisabled,
  setStaffRole,
  signInStaff,
  signOut,
  verifyStaffSecondFactor,
  type StaffRow,
  type StaffSignInResult,
} from './staff';
export { authContext, getViewer, requireOwner, requirePermission, requireStaff, resolveViewer, staffGate, type StaffGate } from './viewer';
export { requireCustomer } from './navigation';
