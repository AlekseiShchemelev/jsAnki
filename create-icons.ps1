Add-Type -AssemblyName System.Drawing

function Create-Icon {
    param([int]$size, [string]$path)
    
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    
    # Background - gradient effect with solid color
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(99, 102, 241))
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)
    
    # Card shape
    $cardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(241, 245, 249))
    $margin = [int]($size * 0.15)
    $cardWidth = $size - ($margin * 2)
    $cardHeight = [int]($cardWidth * 1.4)
    $cardY = $margin + [int](($cardWidth - $cardHeight) / 2)
    $g.FillRectangle($cardBrush, $margin, $cardY, $cardWidth, $cardHeight)
    
    # JS text
    $fontSize = [int]($size * 0.22)
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 41, 59))
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF($margin, $cardY, $cardWidth, $cardHeight)
    $g.DrawString("JS", $font, $textBrush, $rect, $sf)
    
    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# Create icons of different sizes
Create-Icon -size 72 -path "icons/icon-72.png"
Create-Icon -size 96 -path "icons/icon-96.png"
Create-Icon -size 128 -path "icons/icon-128.png"
Create-Icon -size 144 -path "icons/icon-144.png"
Create-Icon -size 152 -path "icons/icon-152.png"
Create-Icon -size 192 -path "icons/icon-192.png"
Create-Icon -size 384 -path "icons/icon-384.png"
Create-Icon -size 512 -path "icons/icon-512.png"

Write-Host "Icons created successfully!"
