// 完整的主题配置
export const equipSheetThemeOverrides = {
  common: {
    primaryColor: '#1f6a52',
    primaryColorHover: '#2a8568',
    primaryColorPressed: '#1a5643',
    primaryColorSuppl: '#1f6a52',
    borderRadius: '16px',
    borderRadiusSmall: '12px'
  },
  Select: {
    peers: {
      InternalSelection: {
        heightMedium: '46px',
        paddingMedium: '10px 16px',
        borderRadius: '16px',
        borderColor: 'rgba(84, 69, 52, 0.12)',
        borderColorHover: 'rgba(31, 106, 82, 0.3)',
        borderColorActive: '#1f6a52',
        boxShadowActive: '0 0 0 4px rgba(31, 106, 82, 0.15), 0 4px 12px rgba(31, 106, 82, 0.1)',
        textColor: '#201812',
        textColorPlaceholder: 'rgba(32, 24, 18, 0.4)',
        arrowColor: '#1f6a52'
      },
      InternalSelectMenu: {
        borderRadius: '16px',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
        padding: '8px'
      },
      SelectOption: {
        borderRadius: '12px',
        heightMedium: '40px',
        paddingMedium: '10px 14px',
        fontSizeMedium: '15px',
        textColorActive: '#1f6a52',
        textColorActiveHover: '#1f6a52',
        fontWeightActive: '700',
        textColorPending: '#201812',
        textColorPendingHover: '#201812'
      }
    }
  },
  Input: {
    heightMedium: '46px',
    paddingMedium: '10px 16px',
    borderRadius: '16px',
    borderColor: 'rgba(84, 69, 52, 0.12)',
    borderColorHover: 'rgba(31, 106, 82, 0.3)',
    borderColorActive: '#1f6a52',
    boxShadowActive: '0 0 0 4px rgba(31, 106, 82, 0.15), 0 4px 12px rgba(31, 106, 82, 0.1)',
    textColor: '#201812',
    textColorPlaceholder: 'rgba(32, 24, 18, 0.4)',
    color: '#201812',
    colorPlaceholder: 'rgba(32, 24, 18, 0.4)'
  }
}
