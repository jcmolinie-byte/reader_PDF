import { GoogleGenAI, Type } from "@google/genai";

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
    model: "gemini-flash-latest",
    contents: `Tu es un extracteur de données pour factures et confirmations de commande industrielles.
    Extrais UNIQUEMENT ces champs si présents, sans commentaire superflu :
    - Date de livraison
    - Numéro de commande (commence par "47")
    - Conditions de paiement
    - Total HT
    - Frais de livraison
    - Prix unitaire
    - Incoterms
    - Adresse de livraison
    Max 20 résultats. Texte : ${text.substring(0, 4000)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            category: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ["text", "category", "reason"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
}
