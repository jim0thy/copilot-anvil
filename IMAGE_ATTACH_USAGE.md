# Image Attachment Feature

## Overview

The TUI now supports attaching images to your prompts using the `/attach` command. Images are sent to the Copilot SDK as file attachments and will be analyzed by vision-capable models.

## Usage

### Method 1: Type the /attach command

```
/attach /path/to/image.png What is in this image?
```

### Method 2: Paste the /attach command

Copy `/attach /path/to/image.png` and paste it into the input box. The TUI will detect it and show:

```
[image 1: /path/to/image.png]
› Your question here
```

### Multiple Images

You can attach multiple images by using multiple `/attach` commands:

```
/attach image1.png /attach image2.jpg Compare these two images
```

Each image will be shown with an incrementing counter:

```
[image 1: image1.png]
[image 2: image2.jpg]
› Compare these two images
```

## Visual Indicators

- **Single image**: `[image 1: filename.png]` displayed with dark text on yellow background
- **Multiple images**: Each image shown on its own line with incrementing numbers
- The /attach command text is automatically removed from your prompt before sending

## Technical Details

- Images are sent as file attachments via the Copilot SDK's `MessageOptions.attachments` field
- The SDK automatically handles the file encoding and transmission to vision-capable models
- Supported image formats depend on the model's capabilities (typically PNG, JPEG, GIF, WebP)

## Example Session

```
› /attach screenshot.png

[image 1: screenshot.png]
› What is shown in this screenshot?
```

The assistant will receive your prompt along with the image attachment and respond accordingly.
