import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface HighlightInfo {
  text: string;
  category: string;
  reason: string;
}

export async function analyzePdfText(text: string): Promise<HighlightInfo[]> {
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: `Extrais ces champs du texte de facture/commande. Réponds UNIQUEMENT en JSON valide, tableau d'objets {text, category}.
Champs : Date de livraison, Numéro de commande (commence par "47"), Conditions de paiement, Total HT, Frais de livraison, Prix unitaire, Incoterms, Adresse de livraison.
Max 15 résultats. Texte : ${text.substring(0, 3000)}`,
  });

  try {
    const raw = (response.text || "[]").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    // Ajoute un reason vide si absent pour compatibilité
    return parsed.map((item: any) => ({ ...item, reason: item.reason || "" }));
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
}
