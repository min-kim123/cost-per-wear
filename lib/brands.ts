import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@cpw_custom_brands_v1";

const DEFAULT_BRANDS = [
  "Acne Studios", "Adidas", "Alexander McQueen", "Alexander Wang",
  "Arc'teryx", "Balenciaga", "Banana Republic", "Bottega Veneta",
  "Burberry", "Calvin Klein", "Carhartt", "Champion", "Chanel",
  "Chrome Hearts", "Coach", "Cole Haan", "Columbia", "Common Projects",
  "Converse", "Cos", "Dior", "Dr. Martens", "Eileen Fisher",
  "Everlane", "Fear of God", "Fendi", "Fossil", "Free People",
  "Gap", "Givenchy", "Gucci", "H&M", "Helmut Lang", "Hermes",
  "Hugo Boss", "J.Crew", "J.Press", "Jordan", "Kate Spade",
  "Kenzo", "Lacoste", "Levi's", "Loewe", "Louis Vuitton",
  "Lululemon", "Maison Margiela", "Marc Jacobs", "Michael Kors",
  "Miu Miu", "Moncler", "New Balance", "Nike", "Noah", "North Face",
  "Off-White", "Patagonia", "Paul Smith", "Polo Ralph Lauren",
  "Prada", "Rag & Bone", "Ralph Lauren", "Rick Owens", "Rolex",
  "Salehe Bembury", "Saint Laurent", "Stone Island", "Supreme",
  "Theory", "Thom Browne", "Todd Snyder", "Tom Ford", "Tommy Hilfiger",
  "Toteme", "Under Armour", "Uniqlo", "Valentino", "Vans",
  "Versace", "Visvim", "Vuori", "Zara",
];

let cache: string[] | null = null;

export async function getBrands(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const custom: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const all = Array.from(new Set([...DEFAULT_BRANDS, ...custom])).sort((a, b) =>
      a.localeCompare(b),
    );
    cache = all;
    return all;
  } catch {
    cache = [...DEFAULT_BRANDS];
    return cache;
  }
}

export async function addBrand(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const all = await getBrands();
  if (all.some((b) => b.toLowerCase() === trimmed.toLowerCase())) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const custom: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!custom.some((b) => b.toLowerCase() === trimmed.toLowerCase())) {
      custom.push(trimmed);
      await AsyncStorage.setItem(KEY, JSON.stringify(custom));
    }
    cache = null; // invalidate cache so next getBrands() re-reads
  } catch {
    // ignore storage errors
  }
}
