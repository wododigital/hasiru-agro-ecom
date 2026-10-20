import { listOrdersAdmin } from '../server';

// Home "Things to do" counts (admin-shell `adminTodos`): the saved views' totals, so the count matches the list it opens.
export const ordersToDispatch = async () => (await listOrdersAdmin({ view: 'unfulfilled', pageSize: 1 })).total;
export const paymentsPending = async () => (await listOrdersAdmin({ view: 'pending_payment', pageSize: 1 })).total;
