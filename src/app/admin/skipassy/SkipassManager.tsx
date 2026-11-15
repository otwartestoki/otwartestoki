"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../client";
import type { Row } from "@/lib/admin/types";

type Product = Row & { id: string; name?: string; provider?: string; pass_type?: string; currency?: string; season_label?: string };
type Price = Row & { id: string; skipass_product_id: string; price?: number | null; category?: string; duration_value?: number | null; duration_unit?: string; valid_from?: string | null; valid_to?: string | null };
type Coverage = Row & { resort_id: string; skipass_product_id: string; coverage_type?: string; notes?: string | null };
type Resort = Row & { id: string; name?: string; city?: string; region?: string };
const productFields = [
  ["name", "Nazwa"], ["provider", "Operator"], ["pass_type", "Rodzaj skipassu"],
  ["currency", "Waluta"], ["url", "Strona zakupu"], ["season_label", "Sezon"], ["notes", "Uwagi"],
] as const;
const priceFields = [
  ["category", "Kategoria", "text"], ["duration_value", "Liczba", "number"], ["duration_unit", "Jednostka", "text"],
  ["price", "Cena", "number"], ["price_type", "Typ ceny", "text"], ["day_type", "Typ dnia", "text"],
  ["valid_from", "Ważna od", "date"], ["valid_to", "Ważna do", "date"], ["source_url", "Źródło ceny", "url"],
] as const;
const txt = (value: unknown) => value == null ? "" : String(value);
const seasonNext = (value: string) => {
  const match = value.match(/(20\d{2})\s*[/–-]\s*(\d{2}|20\d{2})/);
  if (!match) return "";
  const next = Number(match[1]) + 1;
  return `${next}/${String((next + 1) % 100).padStart(2, "0")}`;
};
const priceIsCurrent = (price: Price) => {
  const now = new Date();
  const from = price.valid_from ? new Date(price.valid_from) : null;
  const to = price.valid_to ? new Date(price.valid_to) : null;
  return price.price != null && (!from || Number.isNaN(from.getTime()) || from <= now) && (!to || Number.isNaN(to.getTime()) || to >= now);
};
async function fetchSkipassData() {
  return Promise.all([
    api<{rows: Row[]}>("records?table=skipass_products"), api<{rows: Row[]}>("records?table=skipass_prices"),
    api<{rows: Row[]}>("records?table=skipass_coverage"), api<{rows: Row[]}>("records?table=resorts"),
  ]);
}

export function SkipassManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [resorts, setResorts] = useState<Resort[]>([]);
  const [season, setSeason] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [productDraft, setProductDraft] = useState<Row>({});
  const [coverageDrafts, setCoverageDrafts] = useState<Record<string,Row>>({});
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<Row>({});
  const [resortQuery, setResortQuery] = useState("");
  const [newResort, setNewResort] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({name:"",provider:"",pass_type:"",season_label:""});
  const [sourceSeason, setSourceSeason] = useState("");
  const [targetSeason, setTargetSeason] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [copyProgress, setCopyProgress] = useState("");

  const seasons = useMemo(() => Array.from(new Set(products.map(p => txt(p.season_label).trim()).filter(Boolean))).sort().reverse(), [products]);
  const productPrices = useMemo(() => prices.filter(p => p.skipass_product_id === selected?.id), [prices, selected]);
  const productCoverage = useMemo(() => coverage.filter(c => c.skipass_product_id === selected?.id), [coverage, selected]);

  async function load(keepSeason = true) {
    setLoading(true);
    try {
      const [p, pr, c, r] = await fetchSkipassData();
      const nextProducts = p.rows as Product[];
      setProducts(nextProducts); setPrices(pr.rows as Price[]); setCoverage(c.rows as Coverage[]); setResorts(r.rows as Resort[]);
      setSeason(current => keepSeason && current && nextProducts.some(row => row.season_label === current) ? current : current || nextProducts.map(row => txt(row.season_label)).filter(Boolean).sort().reverse()[0] || "");
      if (selected) setSelected(nextProducts.find(row => row.id === selected.id) || null);
    } catch (error) { setMessage((error as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active=true;
    void fetchSkipassData().then(([p,pr,c,r])=>{
      if(!active)return;
      const nextProducts=p.rows as Product[];
      setProducts(nextProducts);setPrices(pr.rows as Price[]);setCoverage(c.rows as Coverage[]);setResorts(r.rows as Resort[]);
      setSeason(current=>current||nextProducts.map(row=>txt(row.season_label)).filter(Boolean).sort().reverse()[0]||"");
    }).catch(error=>{if(active)setMessage((error as Error).message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);

  const filtered = products.filter(product => {
    if (season && txt(product.season_label) !== season) return false;
    const related = coverage.filter(row => row.skipass_product_id === product.id).map(row => resorts.find(resort => resort.id === row.resort_id)?.name || "").join(" ");
    const productPrice = prices.filter(row => row.skipass_product_id === product.id).map(row => `${row.category} ${row.price} ${row.duration_value} ${row.duration_unit}`).join(" ");
    return `${product.name} ${product.provider} ${product.pass_type} ${product.season_label} ${related} ${productPrice}`.toLocaleLowerCase("pl").includes(query.toLocaleLowerCase("pl"));
  });
  const missingPrices = filtered.reduce((sum, product) => sum + prices.filter(price => price.skipass_product_id === product.id && price.price == null).length, 0);

  async function saveExisting(table: string, row: Row, changes: Row) {
    const identity = table==="skipass_coverage"?{skipass_product_id:row.skipass_product_id,resort_id:row.resort_id}:{id:row.id};
    const current = await api<{record: Row; revision: string}>("record", { table, database: "droplet", identity });
    const saved = await api<{record: Row; writes: {ok: boolean; message: string}[]}>("save", { table, revision: current.revision, changes, database: "droplet" });
    return saved.record;
  }
  async function saveProduct() {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const changes = Object.fromEntries(productFields.filter(([key]) => txt(productDraft[key]) !== txt(selected[key])).map(([key]) => [key, txt(productDraft[key]) || null]));
      const saved = await saveExisting("skipass_products", selected, changes) as Product;
      setSelected(saved); setProductDraft(saved); await load(); setMessage("Zapisano dane skipassu w DigitalOcean.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function savePrice(row: Price) {
    setBusy(true); setMessage("");
    try {
      const changes: Row = {};
      for (const [key, , type] of priceFields) {
        const raw = txt(priceDraft[key]).trim();
        const value = !raw ? null : type === "number" ? Number(raw) : type === "date" ? raw.slice(0,10) : raw;
        const before = type === "date" && row[key] != null ? txt(row[key]).slice(0,10) : row[key] ?? null;
        if (JSON.stringify(value) !== JSON.stringify(before)) changes[key] = value;
      }
      await saveExisting("skipass_prices", row, changes);
      setEditingPrice(null); await load(); setMessage("Zapisano wariant ceny w DigitalOcean.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function addPrice() {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const result = await api<{record: Price}>("skipasses", {action:"add-price",skipass_product_id:selected.id});
      setPrices(current => [...current,result.record]); setEditingPrice(result.record.id); setPriceDraft(result.record); setMessage("Dodano pusty wariant cenowy. Uzupełnij go i zapisz.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function addProduct() {
    if (!newProduct.name.trim() || !newProduct.season_label.trim()) return;
    setBusy(true); setMessage("");
    try {
      const result = await api<{product: Product}>("skipasses", {action:"add-product",...newProduct});
      setProducts(current=>[result.product,...current]); setSeason(result.product.season_label||""); setNewProductOpen(false); open(result.product); setMessage("Dodano skipass. Teraz możesz przypiąć ośrodki i dodać cennik.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function addCoverage() {
    if (!selected || !newResort) return;
    setBusy(true); setMessage("");
    try { await api("skipasses", {action:"add-coverage",skipass_product_id:selected.id,resort_id:newResort}); setNewResort(""); setResortQuery(""); await load(); setMessage("Dodano ośrodek do skipassu."); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function removeCoverage(row: Coverage) {
    const resort = resorts.find(item => item.id === row.resort_id);
    if (!selected || !window.confirm(`Odpiąć „${resort?.name || row.resort_id}” od tego skipassu?`)) return;
    setBusy(true); setMessage("");
    try { await api("skipasses", {action:"remove-coverage",skipass_product_id:selected.id,resort_id:row.resort_id}); await load(); setMessage("Odpięto ośrodek od skipassu."); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function saveCoverage(row: Coverage) {
    const draft=coverageDrafts[row.resort_id]||row;
    const changes:Row={};
    for(const key of ["coverage_type","notes"]) if(txt(draft[key])!==txt(row[key])) changes[key]=txt(draft[key])||null;
    if(!Object.keys(changes).length) return;
    setBusy(true);setMessage("");
    try { await saveExisting("skipass_coverage",row,changes);setCoverageDrafts(current=>{const next={...current};delete next[row.resort_id];return next;});await load();setMessage("Zapisano typ i opis powiązania."); }
    catch(error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function copySeason() {
    const selectedProducts = products.filter(product => chosen.includes(product.id) && txt(product.season_label) === sourceSeason);
    if (!targetSeason.trim() || !selectedProducts.length) return;
    setBusy(true); setMessage(""); let copied = 0; const failed: string[] = [];
    for (let index = 0; index < selectedProducts.length; index++) {
      const product = selectedProducts[index];
      setCopyProgress(`Kopiuję ${index + 1}/${selectedProducts.length}: ${product.name || "skipass"}`);
      try { await api("skipasses", {action:"copy-season",source_product_id:product.id,target_season:targetSeason.trim()}); copied++; }
      catch (error) { failed.push(`${product.name || product.id}: ${(error as Error).message}`); }
    }
    setBusy(false); setCopyProgress(""); setWizard(false); await load();
    setSeason(targetSeason.trim()); setMessage(failed.length ? `Utworzono ${copied} z ${selectedProducts.length}. Nie skopiowano: ${failed.join("; ")}` : `Przygotowano ${copied} skipassów na sezon ${targetSeason}. Ceny są robocze i nie będą pokazywane na stronie, dopóki ich nie uzupełnisz.`);
  }
  function open(product: Product) { setSelected(product); setProductDraft({...product}); setCoverageDrafts({}); setEditingPrice(null); setMessage(""); }

  return <>
    <div className="skipass-heading"><div><h1>Skipassy i sezony</h1><p>Wyszukuj ofertę, poprawiaj cenniki i przypinaj ośrodki. Nowy sezon możesz przygotować z poprzedniego bez publikowania starych cen.</p></div><div className="skipass-heading-actions"><button onClick={()=>{setNewProduct({name:"",provider:"",pass_type:"",season_label:season||seasons[0]||""});setNewProductOpen(true);}}>+ Dodaj skipass</button><button className="primary" disabled={busy || !products.length} onClick={() => { const source=season || seasons[0] || ""; setSourceSeason(source); setTargetSeason(seasonNext(source)); setChosen(products.filter(p => txt(p.season_label)===source).map(p=>p.id)); setWizard(true); }}>Przygotuj nowy sezon</button></div></div>
    <div className="skipass-controls"><label>Sezon<select value={season} onChange={event=>setSeason(event.target.value)}><option value="">Wszystkie sezony</option>{seasons.map(value=><option key={value}>{value}</option>)}</select></label><label className="skipass-search">Szukaj skipassu, ośrodka lub ceny<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="np. Tatry, rodzinny, 220 zł" /></label><button disabled={loading||busy} onClick={()=>load()}>Odśwież</button></div>
    <div className="skipass-summary"><span><b>{filtered.length}</b> ofert</span><span><b>{filtered.reduce((sum,p)=>sum+coverage.filter(c=>c.skipass_product_id===p.id).length,0)}</b> powiązań z ośrodkami</span><span><b>{missingPrices}</b> cen do uzupełnienia</span></div>
    {message&&<p role="status">{message}</p>}{loading?<p>Wczytuję katalog, ceny i ośrodki…</p>:filtered.length===0?<article className="skipass-empty"><h2>{products.length?"Brak wyników":"Brak skipassów"}</h2><p>{products.length?"Zmień sezon lub wyszukiwaną frazę.":"Przygotuj sezon na podstawie poprzedniego albo dodaj skipass z poziomu sezonowego katalogu."}</p>{products.length===0&&<button onClick={()=>{setWizard(true);setSourceSeason(seasons[0]||"");}}>Przygotuj nowy sezon</button>}</article>:<div className="skipass-list">{filtered.map(product=>{const productPrices=prices.filter(price=>price.skipass_product_id===product.id);const productCoverage=coverage.filter(row=>row.skipass_product_id===product.id);const active=productPrices.filter(priceIsCurrent).length;return <article className="skipass-card" key={product.id}><div className="skipass-card-main"><div><span className="skipass-season">{product.season_label||"Bez sezonu"}</span><h2>{product.name||"Bez nazwy"}</h2><p>{[product.provider,product.pass_type].filter(Boolean).join(" · ")||"Operator i typ do uzupełnienia"}</p><small>{productCoverage.length} ośr. · {productPrices.length} wariantów · {active} cen obecnie aktywnych</small></div><button onClick={()=>open(product)}>Zarządzaj →</button></div></article>;})}</div>}

    {selected&&<div className="modal" onMouseDown={event=>{if(event.target===event.currentTarget)setSelected(null);}}><section className="skipass-dialog" role="dialog" aria-modal="true" aria-label={`Zarządzanie skipassem ${selected.name||""}`}><div className="skipass-dialog-head"><div><span className="skipass-season">{selected.season_label||"Bez sezonu"}</span><h2>{selected.name||"Skipass"}</h2></div><button onClick={()=>setSelected(null)}>Zamknij</button></div>
      <section className="skipass-section"><h3>Oferta</h3><div className="fields">{productFields.map(([key,label])=><label key={key}>{label}<input type={key==="url"?"url":"text"} value={txt(productDraft[key])} onChange={event=>setProductDraft({...productDraft,[key]:event.target.value})}/></label>)}</div><button className="primary" disabled={busy||productFields.every(([key])=>txt(productDraft[key])===txt(selected[key]))} onClick={saveProduct}>Zapisz dane skipassu</button></section>
      <section className="skipass-section"><div className="skipass-section-title"><div><h3>Ośrodki, w których obowiązuje</h3><p>{productCoverage.length} powiązań</p></div></div><div className="skipass-add-coverage"><label>Szukaj ośrodka<input value={resortQuery} onChange={event=>{setResortQuery(event.target.value);setNewResort("");}} placeholder="Nazwa, miejscowość lub region" /></label><label>Wybierz ośrodek<select value={newResort} onChange={event=>setNewResort(event.target.value)}><option value="">Wybierz…</option>{resorts.filter(resort=>!productCoverage.some(row=>row.resort_id===resort.id)&&`${resort.name} ${resort.city} ${resort.region}`.toLocaleLowerCase("pl").includes(resortQuery.toLocaleLowerCase("pl"))).map(resort=><option key={resort.id} value={resort.id}>{resort.name}{resort.city?` · ${resort.city}`:""}</option>)}</select></label><button disabled={busy||!newResort} onClick={addCoverage}>Dodaj ośrodek</button></div>{productCoverage.length?<ul className="skipass-coverage-list">{productCoverage.map(row=>{const resort=resorts.find(item=>item.id===row.resort_id);const draft=coverageDrafts[row.resort_id]||row;const changed=txt(draft.coverage_type)!==txt(row.coverage_type)||txt(draft.notes)!==txt(row.notes);return <li key={row.resort_id} className="skipass-coverage-item"><div className="skipass-coverage-name"><b>{resort?.name||"Nieznany ośrodek"}</b><small>{[resort?.city,resort?.region].filter(Boolean).join(" · ")}</small></div><label>Zakres<input value={txt(draft.coverage_type)} onChange={event=>setCoverageDrafts({...coverageDrafts,[row.resort_id]:{...draft,coverage_type:event.target.value}})}/></label><label>Uwagi<input value={txt(draft.notes)} onChange={event=>setCoverageDrafts({...coverageDrafts,[row.resort_id]:{...draft,notes:event.target.value}})}/></label><div className="skipass-coverage-actions"><button disabled={busy||!changed} onClick={()=>saveCoverage(row)}>Zapisz</button><button disabled={busy} onClick={()=>removeCoverage(row)}>Odepnij</button></div></li>;})}</ul>:<p>Ten skipass nie jest jeszcze przypięty do żadnego ośrodka.</p>}</section>
      <section className="skipass-section"><div className="skipass-section-title"><div><h3>Cennik</h3><p>Warianty z pustą ceną nie są publikowane na stronie.</p></div><button disabled={busy} onClick={addPrice}>+ Dodaj wariant ceny</button></div>{productPrices.length===0?<p>Brak wariantów cenowych. Dodaj pierwszy, np. dorosły — 1 dzień.</p>:<div className="skipass-prices">{productPrices.map(price=><article key={price.id} className="skipass-price-card"><div className="skipass-price-title"><div><b>{price.category||"Nowy wariant"}</b><span>{price.price==null?"Do uzupełnienia":`${price.price} ${selected.currency||"PLN"}`} · {price.duration_value??"?"} {price.duration_unit||""}</span><small>{price.valid_from||"bez daty początkowej"} → {price.valid_to||"bez daty końcowej"}</small></div><button onClick={()=>{setEditingPrice(editingPrice===price.id?null:price.id);setPriceDraft({...price});}}>{editingPrice===price.id?"Zamknij edycję":"Edytuj"}</button></div>{editingPrice===price.id&&<div className="fields skipass-price-fields">{priceFields.map(([key,label,type])=><label key={key}>{label}<input type={type} value={type==="date"?txt(priceDraft[key]).slice(0,10):txt(priceDraft[key])} onChange={event=>setPriceDraft({...priceDraft,[key]:event.target.value})}/></label>)}<button className="primary" disabled={busy} onClick={()=>savePrice(price)}>Zapisz wariant ceny</button></div>}</article>)}</div>}</section>
    </section></div>}

    {wizard&&<div className="modal" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setWizard(false);}}><section className="skipass-dialog skipass-wizard" role="dialog" aria-modal="true" aria-label="Przygotuj nowy sezon"><div className="skipass-dialog-head"><div><h2>Przygotuj sezon na bazie poprzedniego</h2><p>Skopiujemy dane produktów i powiązane ośrodki. Warianty cenowe powstaną bez ceny i dat, więc nie pokażą się na stronie, dopóki ich nie uzupełnisz.</p></div><button disabled={busy} onClick={()=>setWizard(false)}>Zamknij</button></div><div className="skipass-controls"><label>Kopiuj z<select value={sourceSeason} onChange={event=>{setSourceSeason(event.target.value);setTargetSeason(seasonNext(event.target.value));setChosen(products.filter(p=>txt(p.season_label)===event.target.value).map(p=>p.id));}}>{seasons.map(value=><option key={value}>{value}</option>)}</select></label><label>Nowy sezon<input value={targetSeason} onChange={event=>setTargetSeason(event.target.value)} placeholder="np. 2027/28" /></label></div>{products.filter(product=>txt(product.season_label)===sourceSeason).length?<div className="skipass-copy-list">{products.filter(product=>txt(product.season_label)===sourceSeason).map(product=><label key={product.id} className="skipass-copy-item"><input type="checkbox" checked={chosen.includes(product.id)} onChange={event=>setChosen(value=>event.target.checked?[...value,product.id]:value.filter(id=>id!==product.id))}/><span><b>{product.name}</b><small>{product.provider} · {coverage.filter(row=>row.skipass_product_id===product.id).length} ośrodków · {prices.filter(row=>row.skipass_product_id===product.id).length} wariantów cen</small></span></label>)}</div>:<p>Nie ma produktów w tym sezonie do skopiowania. Możesz dodać nowy skipass przez przycisk „Dodaj skipass”.</p>}{copyProgress&&<p role="status">{copyProgress}</p>}<div className="skipass-wizard-actions"><span>{chosen.length} wybranych</span><button className="primary" disabled={busy||!targetSeason.trim()||!chosen.length} onClick={copySeason}>{busy?"Kopiuję…":"Utwórz nieopublikowane kopie"}</button></div></section></div>}

    {newProductOpen&&<div className="modal" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setNewProductOpen(false);}}><section className="skipass-dialog skipass-wizard" role="dialog" aria-modal="true" aria-label="Dodaj skipass"><div className="skipass-dialog-head"><div><h2>Dodaj skipass</h2><p>Utwórz ofertę, a potem dodaj jej ceny i ośrodki.</p></div><button disabled={busy} onClick={()=>setNewProductOpen(false)}>Zamknij</button></div><div className="fields"><label>Nazwa<input value={newProduct.name} onChange={event=>setNewProduct({...newProduct,name:event.target.value})}/></label><label>Operator<input value={newProduct.provider} onChange={event=>setNewProduct({...newProduct,provider:event.target.value})}/></label><label>Rodzaj skipassu<input value={newProduct.pass_type} onChange={event=>setNewProduct({...newProduct,pass_type:event.target.value})}/></label><label>Sezon<input value={newProduct.season_label} placeholder="np. 2027/28" onChange={event=>setNewProduct({...newProduct,season_label:event.target.value})}/></label></div><div className="skipass-wizard-actions"><span>Nowe ceny i ośrodki dodasz w następnym kroku.</span><button className="primary" disabled={busy||!newProduct.name.trim()||!newProduct.season_label.trim()} onClick={addProduct}>{busy?"Dodaję…":"Utwórz skipass"}</button></div></section></div>}
  </>;
}
