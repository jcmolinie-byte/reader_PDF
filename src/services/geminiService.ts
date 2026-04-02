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
    contents: `Analyze the following text from a PDF (likely an invoice or order confirmation) and identify these specific pieces of information:
    - Date de livraison (Delivery Date)
    - Numéro de commande (Order Number) - IMPORTANT: Nos numéros de commande commencent TOUJOURS par "47" (ex: 47001234).
    - Conditions de paiement (Payment Terms)
    - Total de la commande hors taxe (Total excluding tax)
    - Frais de livraison (Shipping Fees)
    - Prix par article (Unit price per item)
    - Incoterms (e.g., EXW, FOB, CIF, DDP)
    - Adresse de livraison (Delivery Address)

    IMPORTANT: Limit your response to the most relevant items found (max 30 items total) to avoid exceeding token limits.

    For each item found, identify the exact text in the document, its category, and a brief reason/context.

    Text:
    ${text.substring(0, 12000)}`,
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
