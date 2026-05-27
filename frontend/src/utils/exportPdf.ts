import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * Sanitizes CSS by flattening computed styles to inline RGB/Hex
 * and removing problematic stylesheets.
 */
function sanitizeDocForCapture(clonedDoc: Document) {
  const allElements = Array.from(clonedDoc.querySelectorAll('*'));
  allElements.forEach(el => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return;
    
    // Fix for Recharts ResponsiveContainer:
    // It often has 0 width/height in the clone. Force it to a large fixed size for high-quality capture.
    if (el.classList.contains('recharts-responsive-container') || el.querySelector('.recharts-surface')) {
      el.style.setProperty('width', '1200px', 'important');
      el.style.setProperty('height', '500px', 'important');
      el.style.setProperty('min-width', '1200px', 'important');
      el.style.setProperty('min-height', '500px', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('display', 'block', 'important');
    }

    // Ensure parents of charts don't constrain them
    if (el.id?.includes('analytics-')) {
      el.style.setProperty('width', '1200px', 'important');
      el.style.setProperty('max-width', 'none', 'important');
    }

    const computed = window.getComputedStyle(el);
    const style = (el as HTMLElement).style;

    // Capture all possible color properties
    const colorProps = [
      'color', 'background-color', 'border-color', 'fill', 'stroke', 
      'stop-color', 'outline-color', 'column-rule-color', 'text-decoration-color'
    ];

    colorProps.forEach(prop => {
      let value = computed.getPropertyValue(prop);
      
      // If the value contains unsupported functions, use a safe fallback
      if (value && (value.includes('okl') || value.includes('color-mix'))) {
        if (prop.includes('background')) value = '#0f172a';
        else if (prop === 'color') value = '#f8fafc';
        else value = '#6366f1';
      }
      
      if (value) {
        style.setProperty(prop, value, 'important');
      }
    });
    
    // Fix for layout-critical properties
    const layoutProps = ['opacity', 'visibility', 'display', 'position', 'z-index'];
    layoutProps.forEach(prop => {
      style.setProperty(prop, computed.getPropertyValue(prop), 'important');
    });
  });

  // Nuke all stylesheets and links to prevent html2canvas from parsing them
  const styleTags = Array.from(clonedDoc.getElementsByTagName('style'));
  styleTags.forEach(s => s.remove());
  const links = Array.from(clonedDoc.getElementsByTagName('link'));
  links.forEach(l => { if (l.rel === 'stylesheet') l.remove(); });

  // Final safety: scan and fix any remaining inline styles
  const elementsWithStyle = clonedDoc.querySelectorAll('[style]');
  elementsWithStyle.forEach(el => {
    const htmlEl = el as HTMLElement;
    if (htmlEl.style.cssText.includes('okl') || htmlEl.style.cssText.includes('color-mix')) {
      htmlEl.style.cssText = htmlEl.style.cssText.replace(/(oklch|oklab|lab|lch|color-mix)\((?:[^()]+|\([^()]*\))*\)/g, '#6366f1');
    }
  });
}

/**
 * Exports one or more DOM sections to a single PDF file.
 */
export async function exportSectionsToPDF(
  sectionIds: string[],
  filename: string,
  title?: string
): Promise<void> {
  // Use Landscape for "full screen" feel on Analytics
  const pdf = new jsPDF('l', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 5; // Smaller margin
  const usableWidth = pageWidth - margin * 2;

  let yOffset = margin;

  // Header Background (drawn first)
  if (title) {
    pdf.setFillColor(15, 23, 42); // slate-950
    pdf.rect(0, 0, pageWidth, 20, 'F');
    yOffset = 25;
  }

  for (const id of sectionIds) {
    const el = document.getElementById(id);
    if (!el) continue;

    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#0f172a',
        logging: true,
        onclone: (clonedDoc) => {
          sanitizeDocForCapture(clonedDoc);
        }
      });

      const imgData = canvas.toDataURL('image/png');
      const imgHeight = (canvas.height * usableWidth) / canvas.width;

      // New page if needed
      if (yOffset + imgHeight > pageHeight - margin) {
        pdf.addPage();
        yOffset = margin;
      }

      pdf.addImage(imgData, 'PNG', margin, yOffset, usableWidth, imgHeight);
      yOffset += imgHeight + 6;
    } catch (err) {
      console.error(`Failed to capture section #${id}:`, err);
    }
  }

  pdf.save(`${filename}.pdf`);
}

/**
 * Exports a single element by its ID.
 */
export async function exportElementToPDF(
  elementId: string,
  filename: string
): Promise<void> {
  const el = document.getElementById(elementId);
  if (!el) throw new Error(`Element #${elementId} not found`);

  console.log(`Starting PDF export for #${elementId}...`);

  // Force scroll to left so we capture everything if possible
  const scrollable = el.querySelector('.overflow-x-auto');
  const oldScroll = scrollable ? scrollable.scrollLeft : 0;
  if (scrollable) (scrollable as HTMLElement).scrollLeft = 0;

  try {
    const canvas = await html2canvas(el, {
      scale: 3, // Higher scale for "full screen" quality
      useCORS: true,
      backgroundColor: '#0f172a',
      logging: true,
      imageTimeout: 60000,
      onclone: (clonedDoc) => {
        const clonedEl = clonedDoc.getElementById(elementId);
        if (clonedEl) {
          clonedEl.style.overflow = 'visible';
          clonedEl.style.maxHeight = 'none';
          clonedEl.style.height = 'auto';
          
          const clonedScrollable = clonedEl.querySelector('.overflow-x-auto');
          if (clonedScrollable) {
            (clonedScrollable as HTMLElement).style.overflow = 'visible';
            (clonedScrollable as HTMLElement).style.width = 'auto';
            (clonedScrollable as HTMLElement).style.maxHeight = 'none';
          }
        }
        sanitizeDocForCapture(clonedDoc);
      }
    });

    console.log('Canvas captured successfully, generating PDF...');
    const imgData = canvas.toDataURL('image/png');
    
    // For single element (Gantt), use the exact dimensions to fill the "page"
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width / 3, canvas.height / 3],
    });

    pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 3, canvas.height / 3);
    pdf.save(`${filename}.pdf`);
    console.log('PDF saved.');
  } catch (err: any) {
    console.error('PDF export failed:', err);
    throw err;
  } finally {
    // Restore scroll
    if (scrollable) (scrollable as HTMLElement).scrollLeft = oldScroll;
  }
}
