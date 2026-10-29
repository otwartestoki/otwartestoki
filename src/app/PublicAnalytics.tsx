"use client";
import Script from "next/script";
import {usePathname} from "next/navigation";
export default function PublicAnalytics(){const path=usePathname();if(path.startsWith("/admin"))return null;return (      <>
        {/* ================= GA4 ================= */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-SSRR3SKGWR"
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-SSRR3SKGWR', {
              anonymize_ip: true,
            });
          `}
        </Script>

        {/* ================= CLARITY ================= */}
        <Script id="clarity-init" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;
              t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];
              y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "v27tbgpcv1");
          `}
        </Script>
      </>);}
