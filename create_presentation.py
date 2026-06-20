import os
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

# Define custom theme colors
BG_COLOR = colors.HexColor("#070913")
NAVY_BG = colors.HexColor("#0e1124")
CYAN = colors.HexColor("#00f0ff")
PINK = colors.HexColor("#ff007f")
GREEN = colors.HexColor("#00e676")
WHITE = colors.HexColor("#ffffff")
GRAY = colors.HexColor("#94a3b8")
LIGHT_GRAY = colors.HexColor("#e2e8f0")

class PresentationCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(PresentationCanvas, self).__init__(*args, **kwargs)
        self.pages = []
        
    def showPage(self):
        self.pages.append(dict(self.__dict__))
        self._startPage()
        
    def save(self):
        num_pages = len(self.pages)
        for page in self.pages:
            self.__dict__.update(page)
            self.draw_page_decorations(num_pages)
            super(PresentationCanvas, self).showPage()
        super(PresentationCanvas, self).save()
        
    def draw_page_decorations(self, total_pages):
        self.saveState()
        
        # 1. Fill Background
        self.setFillColor(BG_COLOR)
        self.rect(0, 0, 792, 612, fill=True, stroke=False)
        
        # If it's the first page (Title Slide), draw special background
        if self._pageNumber == 1:
            # Draw decorative glowing panels
            self.setFillColor(NAVY_BG)
            self.rect(50, 50, 692, 512, fill=True, stroke=True)
            self.setStrokeColor(CYAN)
            self.setLineWidth(2)
            self.rect(48, 48, 696, 516, fill=False, stroke=True)
            
            # Subtle branding watermark
            self.setFillColor(colors.Color(0.0, 0.94, 1.0, 0.03))
            self.setFont("Helvetica-Bold", 72)
            self.drawString(100, 250, "AETHER_SHIELD")
        else:
            # Draw standard slide template border and footer
            self.setFillColor(NAVY_BG)
            self.rect(30, 60, 732, 522, fill=True, stroke=False)
            self.setStrokeColor(colors.Color(0.0, 0.94, 1.0, 0.15))
            self.setLineWidth(1)
            self.rect(30, 60, 732, 522, fill=False, stroke=True)
            
            # Header line
            self.setStrokeColor(CYAN)
            self.setLineWidth(1.5)
            self.line(50, 515, 742, 515)
            
            # Header logo/text
            self.setFillColor(CYAN)
            self.setFont("Helvetica-Bold", 10)
            self.drawString(50, 525, "AETHER_SHIELD // SECURE IDENTITY")
            
            # Footer text
            self.setFillColor(GRAY)
            self.setFont("Helvetica", 8)
            self.drawString(50, 40, "CONFIDENTIAL // BIOMETRIC LIVENESS PRESENTATION")
            self.drawRightString(742, 40, f"SLIDE {self._pageNumber} of {total_pages}")
            
        self.restoreState()

def create_presentation():
    pdf_filename = "AETHER_SHIELD_Presentation.pdf"
    doc = SimpleDocTemplate(
        pdf_filename,
        pagesize=landscape(letter),
        leftMargin=50,
        rightMargin=50,
        topMargin=50,
        bottomMargin=70
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'MainTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=32,
        textColor=CYAN,
        spaceAfter=15,
        alignment=1 # Centered
    )
    
    subtitle_style = ParagraphStyle(
        'SubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=14,
        textColor=WHITE,
        spaceAfter=40,
        alignment=1 # Centered
    )
    
    meta_style = ParagraphStyle(
        'MetaText',
        parent=styles['Normal'],
        fontName='Courier-Bold',
        fontSize=10,
        textColor=PINK,
        alignment=1 # Centered
    )
    
    slide_title_style = ParagraphStyle(
        'SlideTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        textColor=CYAN,
        spaceAfter=25,
        topMargin=20
    )
    
    body_style = ParagraphStyle(
        'BodyTextCustom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        textColor=LIGHT_GRAY,
        leading=16,
        spaceAfter=12
    )
    
    bullet_style = ParagraphStyle(
        'BulletCustom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        textColor=LIGHT_GRAY,
        leading=16,
        leftIndent=20,
        firstLineIndent=-10,
        spaceAfter=8
    )
    
    bold_cyan_style = ParagraphStyle(
        'BoldCyan',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        textColor=CYAN,
        leading=16,
        spaceAfter=4
    )

    story = []
    
    # ----------------------------------------------------
    # SLIDE 1: Title Page
    # ----------------------------------------------------
    story.append(Spacer(1, 100))
    story.append(Paragraph("AETHER_SHIELD", title_style))
    story.append(Paragraph("Next-Generation Biometric Anti-Deepfake Liveness Guard", subtitle_style))
    story.append(Spacer(1, 30))
    story.append(Paragraph("TECHNICAL SPECIFICATIONS & LAW ENFORCEMENT APPLICATIONS", meta_style))
    story.append(Spacer(1, 10))
    story.append(Paragraph("VERSION 2.5 // SECURE KYC VERIFICATION", meta_style))
    story.append(PageBreak())
    
    # ----------------------------------------------------
    # SLIDE 2: The Deepfake and Spoofing Challenge
    # ----------------------------------------------------
    story.append(Spacer(1, 30))
    story.append(Paragraph("The Identity Spoofing Threat", slide_title_style))
    story.append(Paragraph("Remote identity verification (KYC) is highly vulnerable to synthetic presentation attacks:", body_style))
    story.append(Spacer(1, 10))
    story.append(Paragraph("<font color='#ff007f'><b>1. Digital Screen Replays:</b></font> Attackers play high-resolution video streams of victims on tablets/smartphones to bypass camera sensors.", bullet_style))
    story.append(Paragraph("<font color='#ff007f'><b>2. Printed Photo Attacks:</b></font> High-definition printed cutouts of facial profiles held in front of the lens.", bullet_style))
    story.append(Paragraph("<font color='#ff007f'><b>3. Video Loops & Virtual Camera Injections:</b></font> Injection of pre-recorded feeds mimicking biometric presence.", bullet_style))
    story.append(Paragraph("<font color='#ff007f'><b>4. Deepfake Puppetry:</b></font> Real-time AI face swapping used to spoof face mesh targets.", bullet_style))
    story.append(Spacer(1, 15))
    story.append(Paragraph("<b>AETHER_SHIELD</b> addresses these vectors by combining active reflection challenges, screen-rasterization analysis, and continuous motion variance tracking.", body_style))
    story.append(PageBreak())
    
    # ----------------------------------------------------
    # SLIDE 3: Optimized System Architecture
    # ----------------------------------------------------
    story.append(Spacer(1, 30))
    story.append(Paragraph("Optimized Hybrid Architecture", slide_title_style))
    story.append(Paragraph("We migrated the prototype from a heavy, synchronous REST layout to a production-ready edge-hybrid system:", body_style))
    story.append(Spacer(1, 10))
    story.append(Paragraph("<font color='#00f0ff'><b>• Client-Side Vision SDK (Edge Compute):</b></font> Face tracking and Aspect Ratio metrics are calculated directly in the browser via MediaPipe WebAssembly. <i>Saves 100% backend GPU/CPU landmarking overhead.</i>", bullet_style))
    story.append(Paragraph("<font color='#00f0ff'><b>• 99% Bandwidth Reduction:</b></font> The client crops and combines skin patches into a single <b>$192 \times 64$ composite JPEG blob (~1.5KB)</b> instead of uploading heavy raw frames (~50KB).", bullet_style))
    story.append(Paragraph("<font color='#00f0ff'><b>• FastAPI & Asynchronous WebSockets:</b></font> Enables persistent, low-latency binary stream transfers for real-time validation, completely replacing slow HTTP polling.", bullet_style))
    story.append(Paragraph("<font color='#00f0ff'><b>• ONNX Runtime Serving:</b></font> The backend model uses CPU-optimized ONNX Runtime instead of PyTorch, dropping serving RAM footprint from <b>~400MB to &lt;50MB</b>.", bullet_style))
    story.append(PageBreak())

    # ----------------------------------------------------
    # SLIDE 4: Core Liveness Detection Engines
    # ----------------------------------------------------
    story.append(Spacer(1, 30))
    story.append(Paragraph("Multi-Dimensional Liveness Safeguards", slide_title_style))
    story.append(Paragraph("The system runs three concurrent safeguards during a 2.4-second verification sequence:", body_style))
    
    table_data = [
        [
            Paragraph("<b>Safeguard Check</b>", bold_cyan_style),
            Paragraph("<b>Detection Logic</b>", bold_cyan_style),
            Paragraph("<b>Threat Vector Blocked</b>", bold_cyan_style)
        ],
        [
            Paragraph("<b>Active Color Reflection</b>", body_style),
            Paragraph("Flashes a randomized color sequence and validates skin/iris reflection correlation on the client.", body_style),
            Paragraph("Pre-recorded video replays and out-of-sync playback streams.", body_style)
        ],
        [
            Paragraph("<b>Moiré CNN Classifier</b>", body_style),
            Paragraph("A lightweight CNN evaluates composite skin crops for high-frequency screen rasterization lines.", body_style),
            Paragraph("High-resolution digital screen replays (smartphones, tablets).", body_style)
        ],
        [
            Paragraph("<b>Continuous Motion Variance</b>", body_style),
            Paragraph("Tracks 3D nose coordinates 45+ times during screen flashes to confirm natural micro-movements.", body_style),
            Paragraph("Static printed photographs and completely still mask attacks.", body_style)
        ]
    ]
    
    t = Table(table_data, colWidths=[150, 320, 220])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#0e1124")),
        ('GRID', (0,0), (-1,-1), 0.5, colors.Color(0.0, 0.94, 1.0, 0.15)),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ----------------------------------------------------
    # SLIDE 5: Law Enforcement & Crime Prevention
    # ----------------------------------------------------
    story.append(Spacer(1, 30))
    story.append(Paragraph("Law Enforcement & Forensics Applications", slide_title_style))
    story.append(Paragraph("How AETHER_SHIELD assists criminal justice and public security agencies:", body_style))
    story.append(Spacer(1, 10))
    story.append(Paragraph("<font color='#00e676'><b>1. Fighting Cyber Fraud and Identity Theft:</b></font> Blocks criminal syndicates from using automated deepfakes to open fake bank accounts, money-mule accounts, or secure illegal government aid.", bullet_style))
    story.append(Paragraph("<font color='#00e676'><b>2. Secure Remote Witness/Parolee Check-ins:</b></font> Guarantees that remote testimonies or parolee surveillance check-ins are physically authentic, preventing suspects from using pre-recorded loop streams.", bullet_style))
    story.append(Paragraph("<font color='#00e676'><b>3. Video Forensic Integrity:</b></font> Backend Moiré classification identifies if a video file submitted as evidence was captured off a digital monitor screen, helping forensic teams uncover doctored/recaptured evidence.", bullet_style))
    story.append(Paragraph("<font color='#00e676'><b>4. Zero-Trust Critical Database Protection:</b></font> Prevents illegal unauthorized access to police databases by enforcing a non-bypassable physical presence verification check.", bullet_style))
    story.append(PageBreak())

    # ----------------------------------------------------
    # SLIDE 6: Gatekeeper Landing & System Outcomes
    # ----------------------------------------------------
    story.append(Spacer(1, 30))
    story.append(Paragraph("Verification Gatekeeper Workflow", slide_title_style))
    story.append(Paragraph("AETHER_SHIELD includes a complete security gatekeeper implementation:", body_style))
    story.append(Spacer(1, 10))
    story.append(Paragraph("<font color='#00f0ff'><b>• Automatic Success Transition:</b></font> Upon successful human verification, the browser saves session metadata in sessionStorage and unlocks access.", bullet_style))
    story.append(Paragraph("<font color='#00f0ff'><b>• Protected Portal (dashboard.html):</b></font> Serves as a secure welcome area displaying biometric metrics (reflection match rate, moiré CNN score).", bullet_style))
    story.append(Paragraph("<font color='#00f0ff'><b>• Anti-Bypass Guard:</b></font> The portal page rejects direct URL loading attempts. If liveness tokens are missing, access is blocked and the user is redirected to the scanner.", bullet_style))
    story.append(Paragraph("<font color='#00f0ff'><b>• Frictionless Experience:</b></font> The head turn check is replaced by continuous passive variance tracking, making validation fast, simple, and error-free for real users.", bullet_style))
    
    # Build Document
    doc.build(story, canvasmaker=PresentationCanvas)
    print(f"Presentation PDF successfully built at: {os.path.abspath(pdf_filename)}")

if __name__ == "__main__":
    create_presentation()
