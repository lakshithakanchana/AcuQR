try {
    if (typeof px !== 'undefined') {
        px.isMobile = false; // Trick Acumatica into disabling touch-specific behaviors
    }
} catch(e) {}
