import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

import { 
  FileUp, 
  Download,
  Search, 
  Highlighter, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  CheckCircle2,
  Info
} from 'lucide-react';
import { analyzePdfText, HighlightInfo } from './services/geminiService';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Use unpkg CDN for the worker - more reliable for StackBlitz
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface PageData {
  canvas: HTMLCanvasElement;
  textItems: any[];
  viewport: any;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [highlights, setHighlights] = useState<HighlightInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      loadPdf(selectedFile);
    } else {
      setError('Veuillez sélectionner un fichier PDF valide.');
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile);
      loadPdf(droppedFile);
    } else {
      setError('Veuillez déposer un fichier PDF valide.');
    }
  };

  const loadPdf = async (file: File) => {
    setLoading(true);
    setError(null);
    setHighlights([]);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      setPdf(pdfDoc);
      setNumPages(pdfDoc.numPages);
      setCurrentPage(1);
      // Lancement automatique de l'analyse après chargement
      handleAnalyze(pdfDoc, pdfDoc.numPages);
    } catch (err: any) {
      console.error('Error loading PDF:', err);
      setError(`Erreur lors du chargement du PDF: ${err.message || 'Erreur inconnue'}`);
    } finally {
      setLoading(false);
    }
  };

  const renderPage = useCallback(async (pageNumber: number) => {
    if (!pdf || !canvasRef.current || !textLayerRef.current) return;

    const page = await pdf.getPage(pageNumber);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    // Render text layer
    const textContent = await page.getTextContent();
    if (!textLayerRef.current) return;
    
    textLayerRef.current.innerHTML = '';
    textLayerRef.current.style.width = `${viewport.width}px`;
    textLayerRef.current.style.height = `${viewport.height}px`;
    
    // Use the correct API for rendering text layer in version 5.x
    // In v5, TextLayer is the preferred way
    const textLayer = new (pdfjsLib as any).TextLayer({
      textContentSource: textContent,
      container: textLayerRef.current,
      viewport: viewport,
    });
    
    await textLayer.render();
  }, [pdf]);

  useEffect(() => {
    if (pdf) {
      renderPage(currentPage);
    }
  }, [pdf, currentPage, renderPage]);

  const handleAnalyze = useCallback(async (pdfDoc?: pdfjsLib.PDFDocumentProxy, pagesCount?: number) => {
    const docToAnalyze = pdfDoc || pdf;
    const count = pagesCount || numPages;
    
    if (!docToAnalyze) return;
    
    setAnalyzing(true);
    setError(null);
    try {
      // Extraction parallèle de toutes les pages (au lieu de séquentielle)
      const pagesToAnalyze = Math.min(count, 5);
      const pagePromises = Array.from({ length: pagesToAnalyze }, (_, i) =>
        docToAnalyze.getPage(i + 1).then(page =>
          page.getTextContent().then(tc =>
            tc.items.map((item: any) => item.str).join(' ')
          )
        )
      );
      const pages = await Promise.all(pagePromises);
      const fullText = pages.join('\n');

      const results = await analyzePdfText(fullText);
      setHighlights(results);
    } catch (err) {
      console.error('Error analyzing PDF:', err);
      setError('Erreur lors de l\'analyse du PDF.');
    } finally {
      setAnalyzing(false);
    }
  }, [pdf, numPages]);

  useEffect(() => {
    if (pdf && highlights.length === 0 && !analyzing && !loading) {
      handleAnalyze();
    }
  }, [pdf, highlights.length, analyzing, loading, handleAnalyze]);

  const applyHighlights = useCallback(() => {
    if (!textLayerRef.current || highlights.length === 0) return;

    const textDivs = Array.from(textLayerRef.current.querySelectorAll('span')) as HTMLElement[];
    if (textDivs.length === 0) return;

    // Clear previous highlights
    textDivs.forEach(div => {
      div.style.backgroundColor = 'transparent';
      div.style.boxShadow = 'none';
    });

    // Strategy: Search for each highlight text across all spans
    highlights.forEach(h => {
      const searchTerm = h.text.toLowerCase().trim();
      if (!searchTerm) return;

      // 1. Simple match (fast)
      textDivs.forEach(div => {
        const divText = (div.textContent || '').toLowerCase();
        if (divText.includes(searchTerm) || searchTerm.includes(divText) && divText.length > 2) {
          div.style.backgroundColor = getCategoryColor(h.category);
          div.style.borderRadius = '2px';
          div.style.boxShadow = `0 0 4px ${getCategoryColor(h.category)}`;
          div.title = `${h.category}: ${h.reason}`;
        }
      });

      // 2. Cross-span match (for fragmented text)
      const fullPageText = textDivs.map(d => d.textContent || '').join(' ');
      const lowerPageText = fullPageText.toLowerCase();
      
      let startIndex = lowerPageText.indexOf(searchTerm);
      while (startIndex !== -1) {
        // Find which spans correspond to this range
        let currentPos = 0;
        textDivs.forEach((div) => {
          const divLen = (div.textContent || '').length + 1; // +1 for the join space
          const divStart = currentPos;
          const divEnd = currentPos + divLen;

          if (startIndex < divEnd && (startIndex + searchTerm.length) > divStart) {
            div.style.backgroundColor = getCategoryColor(h.category);
            div.style.borderRadius = '2px';
            div.style.boxShadow = `0 0 4px ${getCategoryColor(h.category)}`;
          }
          currentPos = divEnd;
        });
        
        startIndex = lowerPageText.indexOf(searchTerm, startIndex + 1);
      }
    });
  }, [highlights]);

  useEffect(() => {
    // Apply highlights after text layer is rendered
    const timer = setTimeout(applyHighlights, 600);
    return () => clearTimeout(timer);
  }, [currentPage, highlights, applyHighlights]);

  const getCategoryColor = (category: string) => {
    const cat = category.toLowerCase();
    if (cat.includes('livraison') && cat.includes('date')) return 'rgba(255, 255, 0, 0.4)'; // Yellow for delivery date
    if (cat.includes('commande') && cat.includes('num')) return 'rgba(0, 255, 0, 0.3)'; // Green for order number
    if (cat.includes('paiement')) return 'rgba(0, 255, 255, 0.3)'; // Cyan for payment terms
    if (cat.includes('total') || cat.includes('hors taxe')) return 'rgba(255, 165, 0, 0.4)'; // Orange for total HT
    if (cat.includes('frais') || cat.includes('expédition')) return 'rgba(255, 0, 255, 0.2)'; // Purple for shipping fees
    if (cat.includes('prix') || cat.includes('unitaire')) return 'rgba(236, 72, 153, 0.3)'; // Pink for unit price
    if (cat.includes('incoterm')) return 'rgba(139, 92, 246, 0.3)'; // Violet for incoterms
    if (cat.includes('adresse')) return 'rgba(59, 130, 246, 0.3)'; // Blue for address
    return 'rgba(200, 200, 200, 0.3)'; // Default grey
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans selection:bg-orange-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center text-white">
            <Highlighter size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Lecteur PDF IA</h1>
            <p className="text-xs text-black/40 font-medium uppercase tracking-wider">Analyse automatique</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!file ? (
            <label className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-sm font-medium cursor-pointer hover:bg-black/80 transition-all active:scale-95">
              <FileUp size={16} />
              <span>Ouvrir un PDF</span>
              <input type="file" className="hidden" accept=".pdf" onChange={onFileChange} />
            </label>
          ) : (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setFile(null)}
                className="text-sm font-medium text-black/60 hover:text-black transition-colors"
              >
                Changer de fichier
              </button>
              <a
                href={file ? URL.createObjectURL(file) : '#'}
                download={file?.name}
                className="flex items-center gap-2 px-4 py-2 bg-black/5 text-black rounded-full text-sm font-medium hover:bg-black/10 transition-all active:scale-95"
              >
                <Download size={16} />
                <span>Télécharger</span>
              </a>
              <button 
                onClick={handleAnalyze}
                disabled={analyzing}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all active:scale-95",
                  analyzing ? "bg-black/5 text-black/40" : "bg-black text-white hover:bg-black/80"
                )}
              >
                {analyzing ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                <span>{analyzing ? 'Analyse en cours...' : 'Analyser avec l\'IA'}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
        {/* PDF Viewer Area */}
        <div className="flex flex-col gap-4">
          {!file ? (
            <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} className={`aspect-[3/4] w-full border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 bg-white transition-colors ${isDragging ? "border-black/40 bg-black/5" : "border-black/10"}`}>
              <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center text-black/20">
                <FileUp size={32} />
              </div>
              <div className="text-center">
                <p className="font-medium text-black/60">Glissez-déposez votre PDF ici</p>
                <p className="text-sm text-black/40">ou cliquez sur "Ouvrir un PDF"</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Controls */}
              <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-black/5 shadow-sm">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="p-2 hover:bg-black/5 rounded-lg disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span className="text-sm font-medium min-w-[80px] text-center">
                    Page {currentPage} / {numPages}
                  </span>
                  <button 
                    onClick={() => setCurrentPage(prev => Math.min(numPages, prev + 1))}
                    disabled={currentPage === numPages}
                    className="p-2 hover:bg-black/5 rounded-lg disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
                
                <div className="flex items-center gap-4 text-sm text-black/40 font-medium overflow-x-auto">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span>Livraison</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                    <span>Commande #</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span>Paiement</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full bg-orange-400" />
                    <span>Total HT</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full bg-purple-400" />
                    <span>Frais</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full bg-pink-400" />
                    <span>Prix Art.</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full bg-violet-500" />
                    <span>Incoterms</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span>Adresse</span>
                  </div>
                </div>
              </div>

              {/* PDF Canvas */}
              <div className="relative bg-white rounded-2xl border border-black/5 shadow-xl overflow-hidden flex justify-center p-8 min-h-[800px]">
                {loading && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
                    <Loader2 className="animate-spin text-black" size={32} />
                  </div>
                )}
                <div className="relative shadow-2xl border border-black/5">
                  <canvas ref={canvasRef} className="max-w-full h-auto relative z-0" />
                  <div 
                    ref={textLayerRef} 
                    className="textLayer absolute top-0 left-0 opacity-1 pointer-events-auto z-10"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar - Insights */}
        <aside className="flex flex-col gap-6">
          <div className="bg-white rounded-3xl border border-black/5 p-6 shadow-sm min-h-[400px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-semibold flex items-center gap-2">
                <Info size={18} className="text-black/40" />
                Points clés
              </h2>
              {highlights.length > 0 && (
                <span className="text-[10px] font-bold bg-black text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
                  {highlights.length} trouvés
                </span>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {analyzing ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
                  <Loader2 className="animate-spin text-black/20" size={32} />
                  <p className="text-sm text-black/40 font-medium">L'IA parcourt le document...</p>
                </div>
              ) : highlights.length > 0 ? (
                <AnimatePresence>
                  {highlights.map((h, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="group p-4 rounded-2xl bg-[#FDFCFB] border border-black/5 hover:border-black/20 transition-all cursor-default"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                          {h.category}
                        </span>
                        <div className="w-1.5 h-1.5 rounded-full bg-black/10 group-hover:bg-black transition-colors" />
                      </div>
                      <p className="text-sm font-semibold mb-1 leading-tight">{h.text}</p>
                      <p className="text-xs text-black/50 leading-relaxed">{h.reason}</p>
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-4 text-center opacity-40">
                  <div className="w-12 h-12 rounded-2xl border border-black/10 flex items-center justify-center">
                    <Search size={24} />
                  </div>
                  <p className="text-sm font-medium">Aucune analyse effectuée</p>
                  <p className="text-xs max-w-[200px]">Cliquez sur "Analyser avec l'IA" pour extraire les informations importantes.</p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3 text-red-600">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {highlights.length > 0 && !analyzing && (
            <div className="bg-green-50 border border-green-100 p-4 rounded-2xl flex items-start gap-3 text-green-700">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <p className="text-sm font-medium">Analyse terminée avec succès.</p>
            </div>
          )}
        </aside>
      </main>

      {/* Global Styles for PDF Text Layer */}
      <style dangerouslySetInnerHTML={{ __html: `
        .textLayer {
          position: absolute;
          left: 0;
          top: 0;
          right: 0;
          bottom: 0;
          overflow: hidden;
          opacity: 1;
          line-height: 1.0;
          text-rendering: optimizeLegibility;
        }
        .textLayer span {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
        }
        .textLayer ::selection {
          background: rgba(0, 0, 255, 0.2);
        }
      `}} />
    </div>
  );
}
