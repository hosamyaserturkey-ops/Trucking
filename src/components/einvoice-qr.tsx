import qrcode from "qrcode-generator";

/**
 * The QR code JoFotara returned for an accepted invoice, drawn as SVG on the
 * server (it prints sharp at any size). The text is encoded exactly as received.
 */
export function EinvoiceQr({ text, size = 120, label = "رمز الفاتورة الإلكترونية" }: { text: string; size?: number; label?: string }) {
  let svg: string | null = null;
  try {
    const qr = qrcode(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch {
    svg = null;
  }
  if (!svg) return <p className="text-xs text-danger">تعذر رسم رمز QR</p>;
  return <div role="img" aria-label={label} style={{ width: size, height: size }} className="bg-white p-1 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
