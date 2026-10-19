/** Default copy for the public enquiry form. Hosts override any key through their messages object. */
export const enquiriesMessages = {
  form: {
    name: 'Your name',
    phone: 'Mobile number',
    phoneHelp: 'We call or WhatsApp you on this number.',
    email: 'Email',
    customerType: 'You are',
    customerTypes: { farmer: 'A farmer', business: 'A business', individual: 'An individual' },
    acres: 'Land size in acres',
    location: 'Where is the land?',
    locationPlaceholder: 'Village, taluk or district',
    timeline: 'When do you want to start?',
    timelines: ['Within a month', 'Within 3 months', 'Within 6 months', 'Just exploring'],
    requirement: 'What would you like to do?',
    notes: 'Anything else we should know?',
    files: 'Photos or documents',
    filesHelp: 'Up to 5 files, 10 MB each: JPG, PNG, WebP, HEIC or PDF. Only our team can see them.',
    optional: 'Optional',
    honeypot: 'Leave this field empty',
    submit: 'Send enquiry',
  },
  outcome: {
    sent: 'Thank you. We have your enquiry and will call you within one working day.',
    invalid: 'Some details look incomplete. Please check your name, mobile number and land details.',
    retry: 'That was quicker than we expected. Please wait a moment and send it again.',
    rate_limited: 'We have received several enquiries from this connection. Please try again in an hour or call us.',
    attachment: 'One of the files could not be accepted. Please send up to 5 photos or PDFs under 10 MB each.',
  },
};

export type EnquiriesMessages = typeof enquiriesMessages;
export type EnquiryOutcomeKey = keyof EnquiriesMessages['outcome'];
