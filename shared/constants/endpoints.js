/**
 * DewClient - External and Public Endpoint Definitions
 */
/**
 * Public Microsoft client identifier for official Minecraft authentication.
 * This is public configuration for desktop OAuth redirection; no client secret is required.
 */
export const MICROSOFT_CLIENT_ID = '00000000402b5328';
export const ENDPOINTS = {
    // Official Mojang / Minecraft Metadata
    MOJANG_MANIFEST_V2: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    MOJANG_MANIFEST_V1: 'https://piston-meta.mojang.com/mc/game/version_manifest.json',
    MOJANG_RESOURCES: 'https://resources.download.minecraft.net',
    // Mod Loaders & Meta
    FABRIC_META: 'https://meta.fabricmc.net/v2',
    FABRIC_MAVEN: 'https://maven.fabricmc.net',
    // Modrinth API v2
    MODRINTH_API: 'https://api.modrinth.com/v2',
    // Microsoft OAuth
    MICROSOFT_AUTHORIZE: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    MICROSOFT_TOKEN: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    MICROSOFT_DEVICE_CODE: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    // Xbox Live Authentication & XSTS
    XBOX_USER_AUTH: 'https://user.auth.xboxlive.com/user/authenticate',
    XBOX_XSTS_AUTH: 'https://xsts.auth.xboxlive.com/xsts/authorize',
    // Minecraft Services
    MINECRAFT_SERVICES_LOGIN: 'https://api.minecraftservices.com/authentication/login_with_xbox',
    MINECRAFT_SERVICES_ENTITLEMENTS: 'https://api.minecraftservices.com/entitlements/mcstore',
    MINECRAFT_SERVICES_PROFILE: 'https://api.minecraftservices.com/minecraft/profile',
    // Java Runtime Downloads (Adoptium Temurin OpenJDK)
    ADOPTIUM_API_V3: 'https://api.adoptium.net/v3/binary/latest',
    // DewClient Central Management & Cosmetics API
    CENTRAL_SERVER_API: 'https://server.dewclient.fun/api/v1'
};
export const ADOPTIUM_RUNTIMES = {
    8: {
        primary: 'https://api.adoptium.net/v3/binary/latest/8/ga/windows/x64/jdk/hotspot/normal/eclipse',
        name: 'Eclipse Temurin OpenJDK 8'
    },
    17: {
        primary: 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse',
        name: 'Eclipse Temurin OpenJDK 17'
    },
    21: {
        primary: 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse',
        name: 'Eclipse Temurin OpenJDK 21'
    },
    25: {
        primary: 'https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jdk/hotspot/normal/eclipse',
        fallback: 'https://api.adoptium.net/v3/binary/latest/25/ea/windows/x64/jdk/hotspot/normal/eclipse',
        name: 'Eclipse Temurin OpenJDK 25'
    }
};
