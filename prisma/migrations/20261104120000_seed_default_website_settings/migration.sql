-- Creates the default CMS settings row if none exists. Existing settings are left
-- untouched. Values match CMS_DEFAULT_SETTINGS in src/models/cms.js.
INSERT IGNORE INTO `WebsiteSetting`
    (`id`, `siteName`, `logoUrl`, `faviconUrl`, `primaryColor`, `secondaryColor`, `accentColor`, `backgroundColor`, `textColor`,
     `headingFont`, `bodyFont`, `headerLayout`, `footerLayout`, `announcementEnabled`, `announcementText`, `announcementLink`,
     `socialLinks`, `defaultSeoTitle`, `defaultSeoDescription`, `themeTokens`, `updatedAt`)
VALUES
    (1, 'ZAEVI', '/assets/zaevi-wordmark.png', '/assets/zaevi-icon.png', '#111111', '#f5f5f3', '#111111', '#ffffff', '#111111',
     'Playfair Display', 'Inter', 'default', 'default', false, '', '',
     '{}', 'ZAEVI', 'Production-on-demand fashion by ZAEVI.', '{}', CURRENT_TIMESTAMP(3));
