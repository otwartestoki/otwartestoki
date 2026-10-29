import type { Metadata } from "next";
import "./admin.css";
export const metadata: Metadata={title:"Panel administratora · Otwarte Stoki",robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}) {return <main className="admin">{children}</main>;}
