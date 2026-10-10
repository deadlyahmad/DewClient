package fun.dewclient.cosmetics.mixin;

import fun.dewclient.cosmetics.render.CosmeticTextureRegistry;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.resources.PlayerSkin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(AbstractClientPlayer.class)
public abstract class AbstractClientPlayerMixin {
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true)
    private void dewcosmetics$applyLocalSkin(CallbackInfoReturnable<PlayerSkin> cir) {
        AbstractClientPlayer player = (AbstractClientPlayer) (Object) this;
        if (Minecraft.getInstance().player == player) {
            cir.setReturnValue(CosmeticTextureRegistry.applyLocalPlayer(cir.getReturnValue()));
        } else {
            cir.setReturnValue(CosmeticTextureRegistry.applyRemotePlayer(player.getUUID(), cir.getReturnValue()));
        }
    }
}
