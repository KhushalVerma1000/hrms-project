import nextConfig from 'eslint-config-next';

// Everything outside these paths must go through @/lib/biometric/facade —
// this is the "biometric is a software module, not scattered API calls"
// boundary made mechanical instead of a comment someone can miss in review.
const BIOMETRIC_MODULE_INTERNALS = [
  'src/lib/biometric/**',
  'src/lib/smartoffice/**',
  // Documented, deliberate exception: worker.ts also dispatches 6
  // SmartOffice taxonomy/setup command types with no equivalent in the
  // vendor-agnostic interface (ADD_COMPANY, ADD_LOCATION, etc.) — see the
  // doc comment at the top of src/lib/biometric/types.ts.
  'src/lib/queue/worker.ts',
];

const noReachIntoBiometricInternals = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@/lib/smartoffice/client', '@/lib/biometric/registry', '@/lib/biometric/adapters/*'],
            message:
              'Import from @/lib/biometric/facade instead of reaching into a biometric adapter or ' +
              'SmartOffice directly — see the module boundary note in src/lib/biometric/types.ts.',
          },
        ],
      },
    ],
  },
};

export default [
  ...nextConfig,
  noReachIntoBiometricInternals,
  {
    files: BIOMETRIC_MODULE_INTERNALS,
    rules: { 'no-restricted-imports': 'off' },
  },
];
