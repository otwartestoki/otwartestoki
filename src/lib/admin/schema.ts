import type { TableSchema } from "./types";
import { HttpError } from "./validation";
export const TABLES: Record<string, TableSchema> = {
  "resorts": {
    "label": "Ośrodki",
    "keys": [
      "id"
    ],
    "title": "name",
    "fields": [
      {
        "key": "name",
        "label": "Nazwa",
        "type": "text",
        "required": true
      },
      {
        "key": "city",
        "label": "Miejscowość",
        "type": "text"
      },
      {
        "key": "region",
        "label": "Region",
        "type": "text"
      },
      {
        "key": "country",
        "label": "Kraj",
        "type": "text"
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "otwarty",
          "zamknięty"
        ]
      },
      {
        "key": "url",
        "label": "Strona ośrodka",
        "type": "url"
      },
      {
        "key": "trail_map_url",
        "label": "Mapa tras — URL",
        "type": "url"
      },
      {
        "key": "webcam_url",
        "label": "Kamery — URL",
        "type": "url"
      },
      {
        "key": "slug",
        "label": "Slug",
        "type": "text"
      },
      {
        "key": "open_lifts",
        "label": "Otwarte wyciągi",
        "type": "integer"
      },
      {
        "key": "lifts_total",
        "label": "Liczba wyciągów",
        "type": "integer"
      }
    ]
  },
  "slopes": {
    "label": "Trasy",
    "keys": [
      "id"
    ],
    "title": "name",
    "resort": "resort",
    "fields": [
      {
        "key": "resort",
        "label": "Ośrodek",
        "type": "resort",
        "required": true
      },
      {
        "key": "number",
        "label": "Numer / oznaczenie",
        "type": "text"
      },
      {
        "key": "name",
        "label": "Nazwa",
        "type": "text"
      },
      {
        "key": "sector",
        "label": "Sektor",
        "type": "text"
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "otwarta",
          "zamknięta"
        ]
      },
      {
        "key": "difficulty",
        "label": "Trudność",
        "type": "select",
        "options": [
          "zielona",
          "niebieska",
          "czerwona",
          "czarna"
        ]
      },
      {
        "key": "length_m",
        "label": "Długość (m)",
        "type": "number"
      },
      {
        "key": "snow",
        "label": "Naśnieżanie",
        "type": "select",
        "options": [
          "tak",
          "nie"
        ]
      },
      {
        "key": "light",
        "label": "Oświetlenie",
        "type": "select",
        "options": [
          "tak",
          "nie"
        ]
      }
    ]
  },
  "lifts": {
    "label": "Wyciągi",
    "keys": [
      "id"
    ],
    "title": "name",
    "resort": "resort",
    "fields": [
      {
        "key": "resort",
        "label": "Ośrodek",
        "type": "resort",
        "required": true
      },
      {
        "key": "number",
        "label": "Numer / oznaczenie",
        "type": "text"
      },
      {
        "key": "name",
        "label": "Nazwa",
        "type": "text"
      },
      {
        "key": "status",
        "label": "Status",
        "type": "select",
        "options": [
          "otwarta",
          "zamknięta"
        ]
      },
      {
        "key": "type",
        "label": "Typ wyciągu",
        "type": "text"
      },
      {
        "key": "seats",
        "label": "Liczba miejsc",
        "type": "integer"
      },
      {
        "key": "capacity_pph",
        "label": "Przepustowość (osób/h)",
        "type": "integer"
      },
      {
        "key": "length_m",
        "label": "Długość (m)",
        "type": "number"
      }
    ]
  },
  "skipass_products": {
    "label": "Skipassy",
    "keys": [
      "id"
    ],
    "title": "name",
    "fields": [
      {
        "key": "name",
        "label": "Nazwa",
        "type": "text",
        "required": true
      },
      {
        "key": "provider",
        "label": "Operator",
        "type": "text"
      },
      {
        "key": "pass_type",
        "label": "Rodzaj karnetu",
        "type": "text"
      },
      {
        "key": "currency",
        "label": "Waluta",
        "type": "text"
      },
      {
        "key": "url",
        "label": "Strona zakupu",
        "type": "url"
      },
      {
        "key": "season_label",
        "label": "Sezon",
        "type": "text"
      },
      {
        "key": "notes",
        "label": "Uwagi",
        "type": "textarea"
      }
    ]
  },
  "skipass_prices": {
    "label": "Ceny skipassów",
    "keys": [
      "id"
    ],
    "title": "category",
    "fields": [
      {
        "key": "skipass_product_id",
        "label": "Skipass",
        "type": "product",
        "required": true
      },
      {
        "key": "category",
        "label": "Kategoria",
        "type": "text"
      },
      {
        "key": "duration_value",
        "label": "Czas ważności — liczba",
        "type": "number"
      },
      {
        "key": "duration_unit",
        "label": "Jednostka czasu",
        "type": "text"
      },
      {
        "key": "price",
        "label": "Cena",
        "type": "number"
      },
      {
        "key": "price_type",
        "label": "Typ ceny",
        "type": "text"
      },
      {
        "key": "day_type",
        "label": "Rodzaj dnia",
        "type": "text"
      },
      {
        "key": "valid_from",
        "label": "Ważna od",
        "type": "date"
      },
      {
        "key": "valid_to",
        "label": "Ważna do",
        "type": "date"
      },
      {
        "key": "source_url",
        "label": "Źródło ceny — URL",
        "type": "url"
      }
    ]
  },
  "skipass_coverage": {
    "label": "Skipassy ↔ ośrodki",
    "keys": [
      "skipass_product_id",
      "resort_id"
    ],
    "title": "coverage_type",
    "resort": "resort_id",
    "fields": [
      {
        "key": "coverage_type",
        "label": "Zakres obowiązywania",
        "type": "text"
      },
      {
        "key": "notes",
        "label": "Uwagi",
        "type": "textarea"
      }
    ]
  }
};
export function tableSchema(name:string):TableSchema { const spec=TABLES[name];if(!spec)throw new HttpError(400,"Niedozwolona tabela.");return spec; }
