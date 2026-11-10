import * as tls from "node:tls";
import { MonitorError } from "./http";
import type { TlsInfo } from "./types";

type Connect = (options: tls.ConnectionOptions) => tls.TLSSocket;

/**
 * Liest das Serverzertifikat. rejectUnauthorized=false, damit auch ein ungültiges Zertifikat gelesen
 * werden kann; `authorized` meldet, ob die Kette vertraut wird. Es werden keine Daten gesendet.
 */
export function probeTls(host: string, port: number, timeoutMs: number, connect: Connect = tls.connect): Promise<TlsInfo> {
  return new Promise<TlsInfo>((resolve, reject) => {
    let done = false;
    const socket = connect({ host, port, servername: host, rejectUnauthorized: false });
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new MonitorError(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s`))), timeoutMs);
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) return finish(() => reject(new MonitorError("Kein Zertifikat erhalten")));
      const issuer = typeof cert.issuer?.O === "string" ? cert.issuer.O : typeof cert.issuer?.CN === "string" ? cert.issuer.CN : undefined;
      const validTo = new Date(cert.valid_to);
      if (Number.isNaN(validTo.getTime())) return finish(() => reject(new MonitorError("Ablaufdatum des Zertifikats unlesbar")));
      finish(() => resolve({ validTo: validTo.toISOString(), authorized: socket.authorized, issuer }));
    });
    socket.once("error", () => finish(() => reject(new MonitorError("TLS-Verbindung fehlgeschlagen"))));
  });
}
