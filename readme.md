# MMX

This utility allows you to create documentation or a single‑page(Not yet avaible) site using a custom format similar to Markdown.

To make the documentation work, your project must contain the following structure:

⚠️This is still under development

## **Required files and folders**

### `config.mcfg` (required)  
Placed in the root of your project.  
It must contain:

```ini
title = "The title of your documentation"
version = "v1.1(The version)"
lang = "en"
sidebarBottomText = "The text next to the version on the bottom of the sidebar"

```
> [!NOTE]
> The lang uses the BCP 47 standar (https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry)

> [!NOTE]
> If you change the sidebar bottom text, it would be appreciated if you mention somewhere that you created the documentation with MMX and include a link to the GitHub.


### `assets/` (optional)  
A folder for images, videos, or any other resources.  
To reference a resource inside it, use:

```
assets/path/to/resource
```
If you put a file named icon.extension (it can be .svg .png .ico .webp .jpg or .jpeg) Ex: icon.png it will be the icon that the browser will show on the tab else the icon will be the browsers default.


### `pages/` (required)  
This folder contains all your `.mmx` files.  
You can also create subfolders to organize your documentation into categories.  
Subfolders can contain more subfolders recursively.

### `index.mmx` (required)  
This is the main entry page of your documentation website.

## Creating your documentation

Inside the `pages/` folder you can:

- Create as many `.mmx` files as you want  
- Create folders to act as categories  
- Nest categories inside categories (recursively)

## Configuring the generator

At the  `config.mcfg`, you must specify:

- The input folder  
- The output folder  
- Whether you want to generate the entire documentation or only a single page  


It will be something similar to this:

```
your-project/
├── config.json
├── index.mmx
├── assets/ ← optional
│   └──logo.png ← the documentation logo
│   └──title.png ← the documentation title, if dont exists, it will be the title text
└── pages/
    ├── introduction.mmx
    ├── getting-started.mmx
    ├── guides/ ← category
    │   ├── install.mmx
    │   ├── usage.mmx
    │   └── advanced/ ← another category inside the category
    │       └── api.mmx
    └── export/ ← another category
        ├── html.mmx
        └── mobile.mmx
```

You can see how it is and more info included the MM sintaxis in https://mmxdocs.vercel.app https://cp-mario.github.io/MMX/ that is made with MMX



This proyect uses:
https://github.com/highlightjs/highlight.js/
https://fonts.google.com/
