# Demo Video
Watch the demo and training video below to see the application in action.

# AcuQR Scanner Setup & Optimizations

This directory contains the AcuQR extension designed to optimize barcode scanning inside Acumatica, specifically tailored for enterprise hardware like the **Zebra TC27-ER / TC27-ES**.

To achieve maximum scanning speed (processing 100+ character JSON QR codes instantly), the script supports Zebra DataWedge's "Paste" delivery mechanism. This bypasses the browser's character-by-character typing buffer.

---

## Step-by-Step DataWedge Setup for TC27-ES

Follow these instructions directly on your Zebra TC27 device to configure the hardware scanner to send data instantly.

### 1. Open DataWedge
- Go to your Android app drawer on the TC27.
- Find and open the **DataWedge** application.

### 2. Select or Create a Profile
- You can either modify the default profile (usually **Profile0 (default)**) which applies to all apps.
- Or, tap the **3 dots** (top right) -> **New Profile**, name it "Acumatica", and associate it specifically with your web browser (e.g., Chrome or Kiwi Browser).
- Tap into the profile to edit its settings.

### 3. Ensure Barcode Input is Enabled
- Scroll down to the **Barcode input** section.
- Ensure the **Enabled** checkbox is checked.

### 4. Configure Keystroke Output (Crucial Step)
- Scroll down to the **Keystroke output** section.
- Ensure the **Enabled** checkbox is checked.
- Tap on **Data delivery mechanism** (or *Key event output* depending on your Android version).
  - Select **Paste** (Highly Recommended).
  - *Note: If "Paste" is unavailable on your firmware, select **Send as string**.*

### 5. Remove Delays
- Still under **Keystroke output**, look for **Inter character delay** or **Key event delay**.
- Set this value to **0** (zero).

### 6. Enable Hardware-Level Event Capture (Scan Without Tapping)
To allow the scanner to inject data *even when no field is actively selected/tapped*, you must force DataWedge to send physical keyboard events:
- Under **Keystroke output**, tap on **Key event options**.
- Check the box for **Send characters as Events**.

### 6. Configure Basic Data Formatting
- Scroll to **Basic data formatting** (inside Keystroke output).
- Ensure **Send ENTER key** is **checked/enabled** if you are using standard Keystroke mode. 
- *Note: If you successfully set the delivery mechanism to **Paste** in Step 4, the Enter key suffix is optional because our script will instantly detect the pasted `{...}` JSON format anyway.*

### 7. Test the Configuration
- Close DataWedge (settings save automatically).
- Open Acumatica in your browser, tap into an Inventory ID field, and scan your JSON QR code.
- You should instantly see the data appear and jump to the next field within milliseconds!

---

## Troubleshooting

- **Scanner is too slow:** Double-check that "Data delivery mechanism" is set to "Paste". If Paste is unavailable, ensure "Send characters as Events" is checked and "Inter character delay" is 0.
- **Nothing happens when scanning without tapping first:** You MUST enable **Send characters as Events** under *Key event options*. Without this, Android's virtual keyboard (IME) swallows the scan data if no text field is active.
- **Values aren't separating:** Ensure your QR code is valid JSON starting with `{` and ending with `}`.
