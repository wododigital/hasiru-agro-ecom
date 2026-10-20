import { listEnquiries } from '../server';

/** Home "Things to do": new enquiries, the count behind /admin/enquiries?status=new (listEnquiries checks enquiries.read). */
export const newEnquiries = async (): Promise<number> => (await listEnquiries({ status: 'new', pageSize: 1 })).total;
