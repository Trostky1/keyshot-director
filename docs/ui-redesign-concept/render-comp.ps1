Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$renderPath = Join-Path $root 'assets\keyshot-render-phone.jpg'
$render = [System.Drawing.Image]::FromFile($renderPath)
$W = 1600
$H = 1000
$C = @{
  ink='#20242A'; inkSoft='#48515C'; muted='#69727C'; faint='#89929B'; line='#E1E4E8'; lineStrong='#CFD4DA'
  paper='#F4F5F6'; surface='#FFFFFF'; soft='#F8F9FA'; nav='#171E27'; navMuted='#B6C0CC'
  blue='#2469D7'; blueHover='#175ABF'; blueSoft='#EEF4FF'; green='#19A36C'; greenSoft='#E9F7F0'; amber='#B46B14'
}

function B([string]$hex) { return [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($hex)) }
function P([string]$hex, [single]$width=1) { return [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($hex), $width) }
function RPath([single]$x,[single]$y,[single]$w,[single]$h,[single]$r) {
  $p = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $p.AddArc($x,$y,$d,$d,180,90); $p.AddArc($x+$w-$d,$y,$d,$d,270,90)
  $p.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90); $p.AddArc($x,$y+$h-$d,$d,$d,90,90)
  $p.CloseFigure(); return $p
}
function FillRound($g,[single]$x,[single]$y,[single]$w,[single]$h,[single]$r,[string]$fill,[string]$stroke='') {
  $path=RPath $x $y $w $h $r; $br=B $fill; $g.FillPath($br,$path)
  if($stroke){$pn=P $stroke; $g.DrawPath($pn,$path);$pn.Dispose()};$br.Dispose();$path.Dispose()
}
function Line($g,[single]$x1,[single]$y1,[single]$x2,[single]$y2,[string]$color,[single]$width=1) {
  $pn=P $color $width; $g.DrawLine($pn,$x1,$y1,$x2,$y2);$pn.Dispose()
}
function Txt($g,[string]$text,[single]$x,[single]$y,[single]$size,[string]$color,[string]$style='Regular',[single]$maxWidth=0) {
  if($style -eq 'Semibold'){$style='Bold'}
  $font=[System.Drawing.Font]::new('Segoe UI',$size,[System.Drawing.FontStyle]$style,[System.Drawing.GraphicsUnit]::Pixel)
  $br=B $color
  if($maxWidth -gt 0){$rect=[System.Drawing.RectangleF]::new($x,$y,$maxWidth,100);$fmt=[System.Drawing.StringFormat]::new();$fmt.Trimming=[System.Drawing.StringTrimming]::EllipsisCharacter;$fmt.FormatFlags=[System.Drawing.StringFormatFlags]::NoWrap;$g.DrawString($text,$font,$br,$rect,$fmt);$fmt.Dispose()}
  else {$g.DrawString($text,$font,$br,$x,$y)}
  $font.Dispose();$br.Dispose()
}
function CenterTxt($g,[string]$text,[single]$x,[single]$y,[single]$w,[single]$h,[single]$size,[string]$color,[string]$style='Regular') {
  if($style -eq 'Semibold'){$style='Bold'}
  $font=[System.Drawing.Font]::new('Segoe UI',$size,[System.Drawing.FontStyle]$style,[System.Drawing.GraphicsUnit]::Pixel);$br=B $color;$fmt=[System.Drawing.StringFormat]::new();$fmt.Alignment=[System.Drawing.StringAlignment]::Center;$fmt.LineAlignment=[System.Drawing.StringAlignment]::Center;$g.DrawString($text,$font,$br,[System.Drawing.RectangleF]::new($x,$y,$w,$h),$fmt);$fmt.Dispose();$br.Dispose();$font.Dispose()
}
function DrawSwitch($g,[single]$x,[single]$y,[bool]$on=$true) {
  $fill=if($on){$C.blue}else{'#C8CED5'}; FillRound $g $x $y 28 16 8 $fill
  $b=B '#FFFFFF';$knobX=if($on){$x+14}else{$x+2};$g.FillEllipse($b,$knobX,$y+2,12,12);$b.Dispose()
}
function DrawDot($g,[single]$x,[single]$y,[string]$fill,[single]$r=6) { $br=B $fill;$g.FillEllipse($br,$x,$y,$r,$r);$br.Dispose() }
function DrawMore($g,[single]$x,[single]$y,[string]$color) { foreach($i in 0..2){$br=B $color;$g.FillEllipse($br,$x+$i*5,$y,2.5,2.5);$br.Dispose()} }
function DrawChevron($g,[single]$x,[single]$y,[string]$color) { Line $g $x $y ($x+4) ($y+4) $color 1.3;Line $g ($x+4) ($y+4) ($x+8) $y $color 1.3 }
function DrawSearch($g,[single]$x,[single]$y,[string]$color) { $pn=P $color 1.2;$g.DrawEllipse($pn,$x,$y,8,8);$g.DrawLine($pn,$x+7,$y+7,$x+11,$y+11);$pn.Dispose() }
function DrawReference($g,[single]$x,[single]$y,[string]$color) { $pn=P $color 1;$g.DrawRectangle($pn,$x,$y,12,10);$g.DrawEllipse($pn,$x+2,$y+2,2,2);$g.DrawLine($pn,$x+1,$y+8,$x+5,$y+5);$g.DrawLine($pn,$x+5,$y+5,$x+8,$y+7);$g.DrawLine($pn,$x+8,$y+7,$x+11,$y+4);$pn.Dispose() }
function DrawArrow($g,[single]$x,[single]$y,[string]$color) { Line $g $x $y ($x+9) $y $color 1.2;Line $g ($x+6) ($y-3) ($x+9) $y $color 1.2;Line $g ($x+6) ($y+3) ($x+9) $y $color 1.2 }
function DrawLightSymbol($g,[single]$x,[single]$y) { FillRound $g $x $y 24 24 6 '#EDF3FA';Line $g ($x+6) ($y+7) ($x+18) ($y+7) '#4B74A9' 1.3;Line $g ($x+7) ($y+9) ($x+5) ($y+17) '#4B74A9' 1.2;Line $g ($x+17) ($y+9) ($x+19) ($y+17) '#4B74A9' 1.2;Line $g ($x+5) ($y+17) ($x+19) ($y+17) '#4B74A9' 1.2 }
function DrawLogo($g,[single]$x,[single]$y) {
  FillRound $g $x $y 29 29 7 '#F5F7FA'
  Txt $g 'K' ($x+6) ($y+1) 21 '#1B2A3B' 'Bold'
  DrawDot $g ($x+20) ($y+7) '#2C74DC' 4
}
function DrawTopbar($g,[string]$active) {
  $b=B $C.nav;$g.FillRectangle($b,0,0,$W,66);$b.Dispose();Line $g 0 65 $W 65 '#10161D'
  DrawLogo $g 30 18;Txt $g 'KeyShot Director' 70 23 14 '#FFFFFF' 'Semibold'
  Line $g 214 22 214 45 '#3C4652';Txt $g 'Current scene' 229 25 11 $C.navMuted
  FillRound $g 625 15 350 36 9 '#202833' '#343E4A'
  foreach($spec in @(@{Name='Studio';X=630;Width=167},@{Name='Materials';X=800;Width=169})){
    if($spec.Name -eq $active){FillRound $g $spec.X 19 $spec.Width 28 6 '#FFFFFF';$color=$C.ink}else{$color='#C4CBD4'}
    CenterTxt $g $spec.Name $spec.X 19 $spec.Width 28 11 $color 'Semibold'
  }
  DrawDot $g 1297 29 '#51CF98' 7;Txt $g 'KeyShot connected' 1311 25 10 '#D9E0E8'
  FillRound $g 1450 16 119 34 8 '#222C37' '#3A4652';CenterTxt $g 'Settings' 1450 16 119 34 10 '#E4E9EF' 'Semibold'
}
function DrawHeading($g,[string]$title,[string]$sub) {
  Txt $g $title 32 88 25 $C.ink 'Semibold';Txt $g $sub 33 122 12 $C.muted
  FillRound $g 1322 91 127 27 14 $C.blueSoft '#D8E6FB';DrawDot $g 1335 101 $C.green 7;Txt $g 'Scene connected' 1348 98 10 '#355B8B' 'Semibold'
  Txt $g 'Changes stay in KeyShot until you save.' 1458 98 9 $C.muted 'Regular' 110
}
function DrawScene($g,[single]$x,[single]$y,[single]$w,[single]$h,[single]$imageScale=1) {
  FillRound $g $x $y $w $h 14 '#FFFFFF' '#E5E7EA'
  $g.DrawImage($render,[single]($x+($w-420*$imageScale)/2),[single]($y+($h-450*$imageScale)/2),[single](420*$imageScale),[single](450*$imageScale))
  FillRound $g ($x+15) ($y+14) 92 27 7 '#FFFFFF' '#E1E5E9';DrawDot $g ($x+26) ($y+24) $C.green 6;Txt $g 'Live scene' ($x+38) ($y+20) 10 '#334454' 'Semibold'
  FillRound $g ($x+$w-276) ($y+13) 261 33 8 '#FFFFFF' '#E2E5E9';Txt $g 'Perspective' ($x+$w-264) ($y+22) 9 '#515D68' 'Regular';DrawChevron $g ($x+$w-176) ($y+24) '#7D8792'
  Line $g ($x+$w-160) ($y+20) ($x+$w-160) ($y+39) '#E3E6E9';CenterTxt $g 'Refresh' ($x+$w-158) ($y+14) 73 31 8 '#5C6672' 'Semibold';CenterTxt $g 'Expand' ($x+$w-84) ($y+14) 67 31 8 '#5C6672' 'Semibold'
  Txt $g 'Product scene  ·  Current camera' ($x+17) ($y+$h-29) 9 '#69727C'
  FillRound $g ($x+$w-219) ($y+$h-33) 202 22 6 '#FFFFFF' '#E4E7EA';CenterTxt $g 'Drag to orbit  ·  wheel to zoom' ($x+$w-214) ($y+$h-32) 192 20 8 '#5F6974'
}
function DrawSlider($g,[single]$x,[single]$y,[single]$w,[single]$percent,[string]$value) {
  $trackY=$y+7;Line $g $x $trackY ($x+$w) $trackY '#DCE1E7' 4;Line $g $x $trackY ($x+$w*$percent) $trackY $C.blue 4
  $br=B '#FFFFFF';$pn=P $C.blue 2;$g.FillEllipse($br,$x+$w*$percent-6,$trackY-6,12,12);$g.DrawEllipse($pn,$x+$w*$percent-6,$trackY-6,12,12);$br.Dispose();$pn.Dispose()
  Txt $g 'Dim' $x ($y+17) 8 '#87909A';Txt $g 'Bright' ($x+$w-33) ($y+17) 8 '#87909A';Txt $g $value ($x+$w-50) ($y-11) 9 '#3A4753' 'Semibold'
}
function DrawLightRow($g,[single]$x,[single]$y,[single]$w,[string]$name,[string]$desc,[string]$power) {
  FillRound $g $x $y $w 43 7 '#FBFCFD' '#E6E9EC';DrawLightSymbol $g ($x+8) ($y+9)
  Txt $g $name ($x+41) ($y+6) 9 '#3D4854' 'Semibold';Txt $g $desc ($x+41) ($y+22) 8 '#858E98'
  Txt $g $power ($x+$w-53) ($y+14) 8 '#56616C' 'Semibold';DrawSwitch $g ($x+$w-34) ($y+13) $true
}
function DrawPanel($g,[single]$x,[single]$y,[single]$w,[single]$h) { FillRound $g $x $y $w $h 12 $C.surface $C.line }

function RenderStudio {
  $bmp=[System.Drawing.Bitmap]::new($W,$H);$g=[System.Drawing.Graphics]::FromImage($bmp);$g.SmoothingMode='AntiAlias';$g.TextRenderingHint='AntiAliasGridFit';$g.Clear([System.Drawing.ColorTranslator]::FromHtml($C.paper))
  DrawTopbar $g 'Studio';DrawHeading $g 'Studio' 'Shape the light around your product.'
  DrawScene $g 32 160 1098 500 1.0
  DrawPanel $g 1150 160 418 760
  $g.FillRectangle((B '#FFFFFF'),1151,161,416,56);Txt $g 'Lighting setup' 1168 179 14 $C.ink 'Semibold';DrawMore $g 1534 184 '#69727C'
  Line $g 1151 217 1567 217 $C.line
  Txt $g 'Studio rig' 1168 233 10 '#3B4651' 'Semibold';Txt $g '3 lights' 1510 233 9 $C.muted
  FillRound $g 1168 251 382 40 7 '#FBFCFD' '#DFE3E7';DrawLightSymbol $g 1178 259;Txt $g 'Soft hero' 1210 263 10 '#35404C' 'Semibold';DrawChevron $g 1530 268 '#7D8792'
  Line $g 1151 305 1567 305 '#ECEEF0'
  Txt $g 'Environment' 1168 322 10 '#3B4651' 'Semibold';Txt $g 'Studio HDRI' 1488 322 9 $C.muted
  DrawSlider $g 1169 351 336 .24 '0.24×'
  Txt $g 'Keep background visible' 1168 389 9 '#5E6873';DrawSwitch $g 1522 389 $true
  Line $g 1151 422 1567 422 '#ECEEF0'
  Txt $g 'Lights' 1168 439 10 '#3B4651' 'Semibold';Txt $g 'Native area lights' 1456 439 9 $C.muted
  DrawLightRow $g 1168 458 382 'Key' 'Large · camera left' '82%'
  DrawLightRow $g 1168 509 382 'Rim' 'Narrow · rear right' '54%'
  DrawLightRow $g 1168 560 382 'Fill' 'Broad · camera right' '18%'
  Txt $g '+  Add light' 1170 617 9 $C.blue 'Semibold'
  Line $g 1151 650 1567 650 '#ECEEF0'
  Txt $g 'Previous look' 1168 669 10 '#46515D' 'Semibold';Txt $g 'Soft key · 2 minutes ago' 1168 689 9 '#858E98';FillRound $g 1495 666 55 28 6 '#FFFFFF' '#D9DEE3';CenterTxt $g 'Undo' 1495 666 55 28 9 '#46515D' 'Semibold'
  Line $g 1151 719 1567 719 '#ECEEF0'
  Txt $g 'Light controls act on the open scene.' 1168 740 9 '#68737E';Txt $g 'Save from KeyShot when you are ready.' 1168 757 9 '#68737E'
  DrawPanel $g 32 679 1098 241
  Txt $g 'Ask Director' 50 697 15 $C.ink 'Semibold';Txt $g 'Describe a look, choose a shot goal, or add a reference. One workflow handles all three.' 50 719 9 $C.muted
  FillRound $g 670 695 206 31 7 '#FFFFFF' '#CFD4DA';Txt $g 'Shot goal' 680 704 8 $C.muted;Txt $g 'Soft hero' 738 703 9 '#35404C' 'Semibold';DrawChevron $g 851 709 '#69727C'
  FillRound $g 886 695 125 31 7 '#F9FAFB' '#AEB9C5';DrawReference $g 897 705 '#46525E';Txt $g 'Add reference' 913 703 9 '#46525E' 'Semibold'
  FillRound $g 50 741 1060 91 9 '#FBFCFD' '#DCE1E6'
  Txt $g 'Describe the lighting and mood you want to create…' 66 755 10 '#828C97'
  FillRound $g 972 789 121 32 7 $C.blue $C.blue;CenterTxt $g 'Create look' 976 789 106 32 9 '#FFFFFF' 'Semibold';DrawArrow $g 1082 805 '#FFFFFF'
  Txt $g 'Lighting edits only · materials stay untouched' 66 815 8 '#687583';Txt $g 'Preview first · save in KeyShot when ready' 754 815 8 '#7A8490'
  Txt $g 'Scene, intent and controls in one view.' 32 947 9 '#5E6974' 'Semibold';Txt $g 'Product geometry and materials are preserved.' 1323 947 9 '#7A8490'
  $out=Join-Path $root 'studio-comp.png';$bmp.Save($out,[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose();return $out
}

function DrawSphere($g,[single]$x,[single]$y,[single]$d,[string]$base,[string]$dark,[string]$light) {
  $br=B $base;$g.FillEllipse($br,$x,$y,$d,$d);$br.Dispose()
  $ellipse=[System.Drawing.Drawing2D.GraphicsPath]::new();$ellipse.AddEllipse($x+2,$y+2,$d-4,$d-4)
  $p=[System.Drawing.Drawing2D.PathGradientBrush]::new($ellipse);$p.CenterPoint=[System.Drawing.PointF]::new($x+$d*.32,$y+$d*.25);$p.CenterColor=[System.Drawing.ColorTranslator]::FromHtml($light);$p.SurroundColors=@([System.Drawing.ColorTranslator]::FromHtml($dark));$g.FillEllipse($p,$x+2,$y+2,$d-4,$d-4);$p.Dispose();$ellipse.Dispose()
  $gl=B '#FFFFFF';$g.FillEllipse($gl,$x+$d*.24,$y+$d*.18,$d*.18,$d*.09);$gl.Dispose()
}
function DrawMaterialRow($g,[single]$x,[single]$y,[string]$name,[string]$meta,[string]$base,[string]$dark,[string]$light,[bool]$selected=$false) {
  if($selected){FillRound $g $x $y 206 56 8 '#F2F6FC' '#D4E2F5'}
  DrawSphere $g ($x+9) ($y+9) 38 $base $dark $light;Txt $g $name ($x+56) ($y+13) 9 '#3B4651' 'Semibold' 129;Txt $g $meta ($x+56) ($y+29) 8 '#808A94' 'Regular' 129
  if($selected){DrawDot $g ($x+189) ($y+24) $C.blue 8}
}
function NodeBox($g,[single]$x,[single]$y,[single]$w,[single]$h,[string]$title,[string[]]$rows,[bool]$selected=$false) {
  $stroke=if($selected){'#5A8ED5'}else{'#CFD6DD'};FillRound $g $x $y $w $h 7 '#FFFFFF' $stroke;FillRound $g $x $y $w 22 7 '#F1F3F5';$g.FillRectangle((B '#F1F3F5'),$x,$y+15,$w,7);Line $g $x ($y+22) ($x+$w) ($y+22) '#E4E7EA';Txt $g $title ($x+8) ($y+5) 8 '#46515D' 'Semibold'
  $ry=$y+29;foreach($row in $rows){DrawDot $g ($x+8) ($ry+3) '#FFFFFF' 7; $pn=P '#A6B1BC';$g.DrawEllipse($pn,$x+8,$ry+3,7,7);$pn.Dispose();Txt $g $row ($x+21) $ry 8 '#71808D';$ry+=14}
}
function RenderMaterials {
  $bmp=[System.Drawing.Bitmap]::new($W,$H);$g=[System.Drawing.Graphics]::FromImage($bmp);$g.SmoothingMode='AntiAlias';$g.TextRenderingHint='AntiAliasGridFit';$g.Clear([System.Drawing.ColorTranslator]::FromHtml($C.paper))
  DrawTopbar $g 'Materials';DrawHeading $g 'Materials' 'Build and tune finishes on your current scene.'
  DrawPanel $g 32 160 224 760;Txt $g 'Material library' 47 177 12 $C.ink 'Semibold';Txt $g 'Your collection' 176 180 8 '#89929B'
  FillRound $g 46 205 195 33 7 '#FBFCFD' '#E0E4E8';DrawSearch $g 56 215 '#77818C';Txt $g 'Search materials' 77 215 9 '#8A939C'
  FillRound $g 46 249 195 31 7 '#F1F3F5';FillRound $g 49 252 96 25 5 '#FFFFFF';CenterTxt $g 'My materials' 49 252 96 25 8 '#35404C' 'Semibold';CenterTxt $g 'KeyShot library' 146 252 92 25 8 '#69737D'
  Txt $g 'CUSTOM PLASTICS' 48 296 8 '#79838D' 'Semibold';DrawMaterialRow $g 45 311 'Advanced Plastic' 'Procedural · 6 maps' '#D5D1C9' '#101318' '#FFFFFF' $true;DrawMaterialRow $g 45 371 'Realistic Plastic' 'Procedural · 4 maps' '#696D73' '#11151A' '#FFFFFF'
  Txt $g 'RECENT FINISHES' 48 448 8 '#79838D' 'Semibold';DrawMaterialRow $g 45 463 'Aluminum polish' 'Metal · KeyShot library' '#BFC4C9' '#3C4146' '#FFFFFF';DrawMaterialRow $g 45 523 'Glass · solid' 'Glass · KeyShot library' '#B8D1DB' '#314752' '#FFFFFF'
  FillRound $g 46 875 195 31 7 '#FFFFFF' '#BAC3CC';CenterTxt $g '+  Add texture set' 46 875 195 31 9 '#4B5967' 'Semibold'
  DrawPanel $g 272 160 938 760
  $g.FillRectangle((B '#FFFFFF'),273,161,936,354);Line $g 273 515 1209 515 $C.line
  FillRound $g 289 174 190 27 7 '#FFFFFF' '#E3E6E9';DrawDot $g 301 184 '#2D77D2' 7;Txt $g 'Current scene  /  selected part' 314 181 9 '#4C5864' 'Semibold';FillRound $g 1074 174 119 25 6 '#FFFFFF' '#E3E6E9';CenterTxt $g 'Preview · not saved' 1074 174 119 25 8 '#68727D'
  $g.DrawImage($render,([single](272+(938-264)/2)),202,264,280)
  Txt $g 'Current camera and lighting' 290 486 8 '#77818C';FillRound $g 1082 477 111 25 6 '#FFFFFF' '#E2E6E9';CenterTxt $g 'Select part' 1082 477 91 25 8 '#52606D';DrawChevron $g 1178 486 '#52606D'
  $g.FillRectangle((B '#FFFFFF'),273,516,936,42);Txt $g 'Advanced Plastic · material graph' 290 531 9 '#3C4652' 'Semibold';FillRound $g 1049 524 63 25 5 '#FFFFFF' '#DFE3E7';CenterTxt $g 'Fit graph' 1049 524 63 25 8 '#52606C';FillRound $g 1118 524 77 25 5 '#263646' '#263646';CenterTxt $g 'Add node' 1118 524 77 25 8 '#FFFFFF' 'Semibold'
  $g.FillRectangle((B '#F8F9FA'),273,558,936,361)
  for($gx=281;$gx -lt 1209;$gx+=16){for($gy=564;$gy -lt 919;$gy+=16){DrawDot $g $gx $gy '#D6DCE2' 1.5}}
  $pen=P '#8796A4' 2
  $g.DrawBezier($pen,402,726,414,726,414,668,425,668)
  $g.DrawBezier($pen,600,668,632,668,650,674,688,674)
  $g.DrawBezier($pen,868,704,900,704,908,700,936,700)
  $g.DrawBezier($pen,402,741,417,741,415,821,441,821)
  $g.DrawBezier($pen,607,821,737,821,787,736,936,736)
  $pen.Dispose()
  NodeBox $g 290 690 112 72 'Spots' @('Texture')
  NodeBox $g 425 625 175 101 'Color to Number' @('Input','Height signal')
  NodeBox $g 688 603 180 134 'Plastic' @('Diffuse','Specular','Roughness','Bump height') $true
  NodeBox $g 441 792 166 89 'Displace' @('Height','Amount  ·  0.01 mm')
  FillRound $g 936 661 160 107 7 '#FFFFFF' '#CFD6DD';FillRound $g 936 661 160 22 7 '#F1F3F5';$g.FillRectangle((B '#F1F3F5'),936,676,160,7);Line $g 936 683 1096 683 '#E4E7EA';Txt $g 'Material output' 944 666 8 '#46515D' 'Semibold';Txt $g 'Surface' 948 697 8 '#5E6A76';Txt $g 'Plastic' 1038 697 8 '#3E5368';Line $g 944 720 1088 720 '#EFF1F3';Txt $g 'Geometry' 948 733 8 '#5E6A76';Txt $g 'Displace' 1033 733 8 '#3E5368'
  DrawPanel $g 1226 160 342 760
  DrawSphere $g 1242 176 38 '#D5D1C9' '#101318' '#FFFFFF';Txt $g 'Advanced Plastic' 1290 178 12 '#28313A' 'Semibold';Txt $g 'Selected material · 1 part' 1290 197 8 '#78838D';DrawMore $g 1532 185 '#77818C';Line $g 1227 223 1567 223 $C.line
  Txt $g 'SURFACE' 1243 240 8 '#53606C' 'Semibold';Txt $g 'Diffuse color' 1243 263 9 '#5A6570';FillRound $g 1442 260 17 17 4 '#BEB8AC' '#C4C0B8';Txt $g '#BEB8AC' 1465 263 8 '#3E4954'
  Txt $g 'Roughness' 1243 291 9 '#5A6570';Line $g 1420 297 1503 297 '#DFE3E7' 3;Line $g 1420 297 1443 297 '#7296C4' 3;Txt $g '0.28' 1514 291 8 '#3E4954' 'Semibold'
  Txt $g 'Specular' 1243 319 9 '#5A6570';Line $g 1420 325 1503 325 '#DFE3E7' 3;Line $g 1420 325 1473 325 '#7296C4' 3;Txt $g '0.64' 1514 319 8 '#3E4954' 'Semibold'
  Line $g 1227 347 1567 347 '#ECEEF0';Txt $g 'TEXTURE MAPS' 1243 364 8 '#53606C' 'Semibold'
  FillRound $g 1243 383 308 30 6 '#FAFBFC' '#E8EBEE';DrawDot $g 1254 395 '#A58B62' 7;Txt $g 'Color' 1268 390 9 '#596570';Txt $g 'Connected' 1482 391 8 '#78838D'
  FillRound $g 1243 419 308 30 6 '#FAFBFC' '#E8EBEE';DrawDot $g 1254 431 '#7C8E9F' 7;Txt $g 'Bump · Spots' 1268 426 9 '#596570';Txt $g '0.06 mm' 1482 427 8 '#78838D'
  Txt $g 'Original texture files are preserved.' 1243 459 8 '#687583'
  Line $g 1227 481 1567 481 '#ECEEF0';Txt $g 'GEOMETRY RELIEF' 1243 498 8 '#53606C' 'Semibold'
  FillRound $g 1243 517 308 117 7 '#F6F8FB' '#DFE7F0';Txt $g 'Displacement' 1254 528 9 '#43515F' 'Semibold';FillRound $g 1474 525 65 19 4 '#E8F1FD';CenterTxt $g 'Geometry' 1474 525 65 19 8 '#416696' 'Semibold'
  Txt $g 'Height input' 1254 556 8 '#64717D';Txt $g 'Grayscale map' 1442 556 8 '#3E4954' 'Semibold';Txt $g 'Amount' 1254 581 8 '#64717D';Txt $g '0.01 mm' 1482 581 8 '#3E4954' 'Semibold'
  FillRound $g 1243 646 308 34 6 '#263646' '#263646';CenterTxt $g 'Execute geometry' 1243 646 308 34 9 '#FFFFFF' 'Semibold'
  Txt $g 'Subtle relief is previewed in millimeters.' 1243 692 8 '#687583';Txt $g 'Execution is explicit; source stays untouched.' 1243 706 8 '#687583'
  Line $g 1227 729 1567 729 '#ECEEF0';Txt $g 'Part assignment' 1243 748 9 '#46515D' 'Semibold';Txt $g '1 selected part' 1243 768 8 '#78838D';FillRound $g 1468 744 83 28 6 '#FFFFFF' '#D9DEE3';CenterTxt $g 'Choose part' 1468 744 83 28 8 '#46515D' 'Semibold'
  Txt $g 'Material graph stays connected to the current scene.' 32 947 9 '#5E6974' 'Semibold';Txt $g 'Material and geometry changes remain explicit.' 1341 947 9 '#7A8490'
  $out=Join-Path $root 'materials-comp.png';$bmp.Save($out,[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose();return $out
}

$studio=RenderStudio
$materials=RenderMaterials
$render.Dispose()
Write-Output "Rendered $studio"
Write-Output "Rendered $materials"
