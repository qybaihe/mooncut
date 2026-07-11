import { AbilityConstant, Configuration, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

export default class EntryAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    AppStorage.setOrCreate<ConfigurationConstant.ColorMode>('currentColorMode', this.context.config.colorMode);
    hilog.info(0x0000, 'MoonCut', 'EntryAbility created');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (error) => {
      if (error.code) {
        hilog.error(0x0000, 'MoonCut', 'Failed to load MoonCut: %{public}s', JSON.stringify(error));
      }
    });
  }

  onConfigurationUpdate(configuration: Configuration): void {
    AppStorage.setOrCreate<ConfigurationConstant.ColorMode>('currentColorMode', configuration.colorMode);
    hilog.info(0x0000, 'MoonCut', 'Configuration updated');
  }
}
