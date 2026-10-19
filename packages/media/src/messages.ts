// Default copy for media (host apps override). Upload errors reach storefront forms too (enquiry and review photos).
export const mediaMessages = {
  credit: { prefix: 'Photo' },
  errors: {
    unsupported_type: 'This file type is not supported. Upload a JPEG, PNG, WebP, AVIF or GIF image, or a PDF.',
    svg_refused: 'SVG files are not accepted. Upload a PNG or JPEG instead.',
    heic_unsupported: 'HEIC photos are not supported yet. Change the camera format to JPEG or export the photo as JPEG.',
    not_allowed: 'This field does not accept that kind of file.',
    too_large: 'The file is larger than 12 MB.',
    corrupt: 'The image could not be read. It may be damaged.',
    empty: 'The file is empty.',
    no_file: 'Choose a file to upload.',
    invalid: 'Some details are not valid. Check the fields and try again.',
    forbidden: 'You do not have permission to upload media.',
    cross_origin: 'The upload came from another site and was refused.',
  },
} as const;

export type MediaMessages = typeof mediaMessages;
export type MediaErrorCode = keyof MediaMessages['errors'];
