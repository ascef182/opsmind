export const SOCIAL_PLATFORMS = ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'WHATSAPP', 'TIKTOK', 'TWITTER', 'YOUTUBE', 'OTHER'] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
}
