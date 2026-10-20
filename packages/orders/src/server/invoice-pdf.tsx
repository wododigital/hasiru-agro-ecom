import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { istDateTime } from '../domain';
import { ordersMessages, type OrdersMessages } from '../messages';
import type { InvoiceDocument } from './invoice';

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', lineHeight: 1.4 },
  h1: { fontSize: 16, marginBottom: 8, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row' },
  col: { flex: 1, paddingRight: 8 },
  label: { color: 'dimgray' },
  th: { fontFamily: 'Helvetica-Bold', borderBottom: '1pt solid darkgray', paddingVertical: 3 },
  td: { borderBottom: '0.5pt solid gainsboro', paddingVertical: 3 },
  right: { textAlign: 'right' },
  total: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 6 },
});

const rs = (p: number) => formatINR(p as Paise);
const W = { item: 3, hsn: 1, qty: 0.7, rate: 0.8, amount: 1.4 };

function InvoicePdf({ doc, m }: { doc: InvoiceDocument; m: OrdersMessages['invoice'] }) {
  const b = doc.buyer;
  return (
    <Document title={`${m.title} ${doc.number}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>{m.title}</Text>
        <View style={[s.row, { marginBottom: 10 }]}>
          <View style={s.col}>
            <Text>{`${m.number} ${doc.number}`}</Text>
            <Text>{`${m.date} ${istDateTime(new Date(doc.issuedAt))}`}</Text>
            <Text>{`${m.order} ${doc.orderNumber}`}</Text>
            <Text>{`${m.placeOfSupply} ${doc.placeOfSupply ?? '-'}`}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>{m.seller}</Text>
            <Text>{doc.seller.legalName}</Text>
            {doc.seller.address ? <Text>{doc.seller.address}</Text> : null}
            {doc.seller.gstin ? <Text>{`${m.gstin} ${doc.seller.gstin}`}</Text> : null}
          </View>
          <View style={s.col}>
            <Text style={s.label}>{m.buyer}</Text>
            <Text>{b.legalName ?? b.name}</Text>
            {b.address ? <Text>{b.address}</Text> : null}
            {b.phone ? <Text>{b.phone}</Text> : null}
            {b.gstin ? <Text>{`${m.gstin} ${b.gstin}`}</Text> : null}
          </View>
        </View>
        <View style={s.row}>
          <Text style={[s.th, { flex: W.item }]}>{m.item}</Text>
          <Text style={[s.th, { flex: W.hsn }]}>{m.hsn}</Text>
          <Text style={[s.th, s.right, { flex: W.qty }]}>{m.qty}</Text>
          <Text style={[s.th, s.right, { flex: W.rate }]}>{m.rate}</Text>
          <Text style={[s.th, s.right, { flex: W.amount }]}>{m.amount}</Text>
        </View>
        {doc.lines.map((l, i) => (
          <View key={i} style={s.row}>
            <Text style={[s.td, { flex: W.item }]}>{l.sku ? `${l.name} (${l.sku})` : l.name}</Text>
            <Text style={[s.td, { flex: W.hsn }]}>{l.hsn ?? '-'}</Text>
            <Text style={[s.td, s.right, { flex: W.qty }]}>{String(l.qty)}</Text>
            <Text style={[s.td, s.right, { flex: W.rate }]}>{`${l.gstRatePct}`}</Text>
            <Text style={[s.td, s.right, { flex: W.amount }]}>{rs(l.totalPaise)}</Text>
          </View>
        ))}
        {doc.chargesPaise > 0 ? (
          <View style={s.row}>
            <Text style={[s.td, { flex: W.item + W.hsn + W.qty + W.rate }]}>{m.charges}</Text>
            <Text style={[s.td, s.right, { flex: W.amount }]}>{rs(doc.chargesPaise)}</Text>
          </View>
        ) : null}
        {doc.discountPaise > 0 ? <Text style={{ marginTop: 4 }}>{`${m.discount}: ${rs(doc.discountPaise)}`}</Text> : null}
        <View style={[s.row, { marginTop: 10 }]}>
          <Text style={[s.th, { flex: 1 }]}>{m.hsn}</Text>
          <Text style={[s.th, s.right, { flex: 1 }]}>{m.rate}</Text>
          <Text style={[s.th, s.right, { flex: 1.4 }]}>{m.taxable}</Text>
          <Text style={[s.th, s.right, { flex: 1.2 }]}>{doc.isInterState ? m.igst : m.cgst}</Text>
          {doc.isInterState ? null : <Text style={[s.th, s.right, { flex: 1.2 }]}>{m.sgst}</Text>}
        </View>
        {doc.tax.rows.map((r, i) => (
          <View key={i} style={s.row}>
            <Text style={[s.td, { flex: 1 }]}>{r.hsn || '-'}</Text>
            <Text style={[s.td, s.right, { flex: 1 }]}>{`${r.ratePct}`}</Text>
            <Text style={[s.td, s.right, { flex: 1.4 }]}>{rs(r.taxablePaise)}</Text>
            <Text style={[s.td, s.right, { flex: 1.2 }]}>{rs(doc.isInterState ? r.igstPaise : r.cgstPaise)}</Text>
            {doc.isInterState ? null : <Text style={[s.td, s.right, { flex: 1.2 }]}>{rs(r.sgstPaise)}</Text>}
          </View>
        ))}
        <Text style={[s.total, s.right]}>{`${m.total}: ${rs(doc.tax.totalPaise)}`}</Text>
        <Text style={{ marginTop: 16, color: 'dimgray' }}>{m.note}</Text>
      </Page>
    </Document>
  );
}

/** Renders the frozen invoice document to a PDF (A4). */
export async function invoicePdf(doc: InvoiceDocument, messages: OrdersMessages['invoice'] = ordersMessages.invoice): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf doc={doc} m={messages} />);
}
