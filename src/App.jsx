import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  addDoc, collection, doc, increment, limit, onSnapshot, orderBy,
  query, serverTimestamp, updateDoc, writeBatch
} from "firebase/firestore";
import { auth, db } from "./firebase";
import "./App.css";

const MINIMO = 3; // se marca en rojo cuando hay MENOS de esta cantidad
const TALLAS = ["S", "M", "L", "XL", "XXL", "3XL"];
const COLORES = ["Blanco", "Negro"];
const ROPA = [
  "Hoodie poliéster", "Hoodie algodón",
  "Hoodie con zipper poliéster", "Hoodie con zipper algodón",
  "Hoodie balaclava poliéster", "Hoodie balaclava algodón",
  "Hoodie crop con zipper poliéster", "Hoodie crop con zipper algodón",
  "Hoodie crop sin zipper poliéster", "Hoodie crop sin zipper algodón",
  "Camisa oversize", "Camisa normal",
  "Camisa polo poliéster", "Camisa polo algodón",
];
const INSUMOS = [
  "Tazas", "Bolsas para camisas", "Bolsas para hoodies",
  "Bolsas negras de envío pequeñas", "Bolsas negras de envío grandes",
  "Rollo de vinil tornasol", "Rollo de vinil gris", "Rollo de vinil blanco",
];

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-");
const itemId = (i) => `${slug(i.producto)}_${slug(i.talla || "u")}_${slug(i.color || "u")}`;
const nombreItem = (i) => [i.producto, i.talla, i.color].filter(Boolean).join(" · ");

export default function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (user === undefined) return <p className="msg">Cargando…</p>;
  return user ? <Inventario user={user} /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");

  async function entrar(e) {
    e.preventDefault();
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch {
      setError("Correo o contraseña incorrectos.");
    }
  }

  return (
    <main className="login">
      <img className="logo-login" src="/logo.png" alt="Grasso" />
      <h1 className="sr">Inventario</h1>
      <p>Entra con tu correo para ver y mover el stock.</p>
      <form onSubmit={entrar}>
        <input type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Contraseña" value={pass} onChange={(e) => setPass(e.target.value)} required />
        {error && <p className="error">{error}</p>}
        <button className="primario">Entrar</button>
      </form>
    </main>
  );
}

// Los botones suman o restan de 1 en 1. El número se puede tocar y escribir directo (ej. 25).
function Contador({ item, onMover }) {
  const bajo = item.cantidad < MINIMO;
  const [texto, setTexto] = useState(String(item.cantidad));
  useEffect(() => setTexto(String(item.cantidad)), [item.cantidad]);

  function confirmar() {
    const n = parseInt(texto, 10);
    if (Number.isNaN(n) || n < 0) return setTexto(String(item.cantidad));
    if (n !== item.cantidad) onMover(item, n - item.cantidad);
  }

  return (
    <div className={"contador" + (bajo ? " bajo" : "")}>
      <button onClick={() => onMover(item, -1)} disabled={item.cantidad <= 0} aria-label="Restar uno">−</button>
      <input
        type="number" inputMode="numeric" min="0" value={texto} aria-label="Cantidad"
        onChange={(e) => setTexto(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={confirmar}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
      />
      <button onClick={() => onMover(item, 1)} aria-label="Sumar uno">+</button>
    </div>
  );
}

// Está FUERA de Inventario a propósito: así no se recrea y la tarjeta se queda abierta.
function Tarjeta({ producto, lista, onMover }) {
  const total = lista.reduce((s, i) => s + i.cantidad, 0);
  const nBajos = lista.filter((i) => i.cantidad < MINIMO).length;
  const cabecera = (
    <>
      <span className="nombre">{producto}</span>
      <span className="total">{total} en total</span>
      {nBajos > 0 && <span className="aviso">{nBajos} bajo{nBajos > 1 ? "s" : ""}</span>}
    </>
  );

  if (lista.length === 1)
    return (
      <div className="tarjeta fila">
        <div className="cab">{cabecera}</div>
        <Contador item={lista[0]} onMover={onMover} />
      </div>
    );

  return (
    <details className="tarjeta">
      <summary className="cab">{cabecera}</summary>
      <table>
        <thead>
          <tr><th></th>{COLORES.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {TALLAS.map((t) => (
            <tr key={t}>
              <th>{t}</th>
              {COLORES.map((c) => {
                const it = lista.find((i) => i.talla === t && i.color === c);
                return <td key={c}>{it && <Contador item={it} onMover={onMover} />}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Inventario({ user }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("ropa");
  const [busca, setBusca] = useState("");
  const [historial, setHistorial] = useState([]);

  useEffect(
    () =>
      onSnapshot(
        collection(db, "stock"),
        (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setError("No se pudo leer el inventario. Revisa las reglas de Firestore.")
      ),
    []
  );

  useEffect(() => {
    if (tab !== "historial") return;
    const q = query(collection(db, "movimientos"), orderBy("fecha", "desc"), limit(50));
    return onSnapshot(q, (snap) => setHistorial(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [tab]);

  const porProducto = useMemo(() => {
    const m = new Map();
    (items || []).forEach((i) => m.set(i.producto, [...(m.get(i.producto) || []), i]));
    return m;
  }, [items]);

  const bajos = useMemo(
    () => (items || []).filter((i) => i.cantidad < MINIMO).sort((a, b) => nombreItem(a).localeCompare(nombreItem(b))),
    [items]
  );

  async function mover(item, delta) {
    if (item.cantidad + delta < 0) return;
    try {
      await updateDoc(doc(db, "stock", item.id), { cantidad: increment(delta) });
      await addDoc(collection(db, "movimientos"), {
        producto: item.producto, talla: item.talla, color: item.color,
        delta, usuario: user.email, fecha: serverTimestamp(),
      });
    } catch {
      setError("No se pudo guardar el cambio. Revisa tu conexión.");
    }
  }

  async function cargarInicial() {
    const lista = [];
    ROPA.forEach((p) => TALLAS.forEach((t) => COLORES.forEach((c) => lista.push({ producto: p, categoria: "ropa", talla: t, color: c }))));
    INSUMOS.forEach((p) => lista.push({ producto: p, categoria: "insumo", talla: "", color: "" }));
    const batch = writeBatch(db);
    lista.forEach((i) => batch.set(doc(db, "stock", itemId(i)), { ...i, cantidad: 0 }));
    await batch.commit();
  }

  // Excel de verdad: una hoja de ropa (tallas en columnas), una de insumos y una de poco stock.
  async function exportarExcel() {
    const mod = await import("exceljs/dist/exceljs.min.js");
    const ExcelJS = mod.default || mod;
    const wb = new ExcelJS.Workbook();
    const borde = { style: "thin", color: { argb: "FFD6DBE3" } };
    const bordes = { top: borde, left: borde, bottom: borde, right: borde };
    const centro = { horizontal: "center", vertical: "middle" };
    const pintar = (cell, bajo) => {
      cell.border = bordes;
      cell.alignment = centro;
      if (bajo) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDECEC" } };
        cell.font = { bold: true, color: { argb: "FFD33A3A" } };
      }
    };
    const encabezado = (ws) => {
      ws.getRow(1).eachCell((c) => {
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF161A22" } };
        c.alignment = centro;
        c.border = bordes;
      });
      ws.views = [{ state: "frozen", ySplit: 1 }];
    };
    const cant = new Map((items || []).map((i) => [`${i.producto}|${i.talla}|${i.color}`, i.cantidad]));

    const ropa = wb.addWorksheet("Ropa");
    ropa.columns = [
      { header: "Producto", width: 34 }, { header: "Color", width: 10 },
      ...TALLAS.map((t) => ({ header: t, width: 7 })), { header: "Total", width: 9 },
    ];
    encabezado(ropa);
    ROPA.forEach((p) => {
      const inicio = ropa.rowCount + 1;
      COLORES.forEach((c) => {
        const vals = TALLAS.map((t) => cant.get(`${p}|${t}|${c}`) ?? 0);
        const fila = ropa.addRow([p, c, ...vals, vals.reduce((a, b) => a + b, 0)]);
        fila.eachCell((cell, n) => {
          if (n === 1) { cell.border = bordes; cell.alignment = { vertical: "middle", wrapText: true }; cell.font = { bold: true }; }
          else if (n === 2) { cell.border = bordes; cell.alignment = centro; }
          else pintar(cell, n <= 2 + TALLAS.length && cell.value < MINIMO);
        });
      });
      ropa.mergeCells(`A${inicio}:A${inicio + COLORES.length - 1}`);
    });

    const ins = wb.addWorksheet("Insumos");
    ins.columns = [{ header: "Producto", width: 36 }, { header: "Cantidad", width: 11 }];
    encabezado(ins);
    INSUMOS.forEach((p) => {
      const q = cant.get(`${p}||`) ?? 0;
      const fila = ins.addRow([p, q]);
      fila.getCell(1).border = bordes;
      pintar(fila.getCell(2), q < MINIMO);
    });

    const pocos = wb.addWorksheet("Poco stock");
    pocos.columns = [
      { header: "Producto", width: 34 }, { header: "Talla", width: 8 },
      { header: "Color", width: 10 }, { header: "Cantidad", width: 11 },
    ];
    encabezado(pocos);
    bajos.forEach((i) => {
      const fila = pocos.addRow([i.producto, i.talla, i.color, i.cantidad]);
      fila.eachCell((cell) => pintar(cell, false));
      pintar(fila.getCell(4), true);
    });

    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `inventario-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
  }

  const q = norm(busca.trim());
  const lista = (tab === "ropa" ? ROPA : INSUMOS).filter((p) => norm(p).includes(q));

  return (
    <div className="app">
      <div className="barra">
        <header>
          <h1 className="marca">
            <img className="logo" src="/logo.png" alt="Grasso" />
            <span className="sr">Inventario</span>
          </h1>
          <div>
            <button onClick={exportarExcel} disabled={!items?.length}>Descargar Excel</button>
            <button onClick={() => signOut(auth)}>Salir</button>
          </div>
        </header>
        <nav>
          <button className={tab === "ropa" ? "activa" : ""} onClick={() => setTab("ropa")}>Ropa</button>
          <button className={tab === "insumos" ? "activa" : ""} onClick={() => setTab("insumos")}>Insumos</button>
          <button className={tab === "bajos" ? "activa" : ""} onClick={() => setTab("bajos")}>
            Poco stock{bajos.length > 0 && <b className="punto">{bajos.length}</b>}
          </button>
          <button className={tab === "historial" ? "activa" : ""} onClick={() => setTab("historial")}>Historial</button>
        </nav>
        {(tab === "ropa" || tab === "insumos") && (
          <input className="buscar" type="search" placeholder="Buscar producto (ej. polo, crop, vinil)" value={busca} onChange={(e) => setBusca(e.target.value)} />
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {items === null && <p className="msg">Cargando inventario…</p>}

      {items && items.length === 0 && (
        <div className="vacio">
          <p>Todavía no hay productos. Carga la lista inicial con todo en 0 y luego cuenta lo que tienes.</p>
          <button className="primario" onClick={cargarInicial}>Cargar productos</button>
        </div>
      )}

      {items?.length > 0 && (tab === "ropa" || tab === "insumos") && (
        <section>
          {lista.length === 0 && <p className="msg">No hay productos con ese nombre.</p>}
          {lista.map((p) => <Tarjeta key={p} producto={p} lista={porProducto.get(p) || []} onMover={mover} />)}
        </section>
      )}

      {items?.length > 0 && tab === "bajos" && (
        <section>
          {bajos.length === 0 && <p className="msg">Todo tiene {MINIMO} o más piezas.</p>}
          {bajos.map((i) => (
            <div className="tarjeta fila" key={i.id}>
              <span className="nombre">{nombreItem(i)}</span>
              <Contador item={i} onMover={mover} />
            </div>
          ))}
        </section>
      )}

      {tab === "historial" && (
        <section>
          {historial.length === 0 && <p className="msg">Aún no hay movimientos.</p>}
          {historial.map((h) => (
            <div className="tarjeta mov" key={h.id}>
              <span className={h.delta > 0 ? "mas" : "menos"}>{h.delta > 0 ? "+" : ""}{h.delta}</span>
              <span className="nombre">{nombreItem(h)}</span>
              <small>{h.usuario} · {h.fecha?.toDate().toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}</small>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
