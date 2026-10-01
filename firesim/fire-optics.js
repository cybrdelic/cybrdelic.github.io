/* Shared optical coefficients: the flame, smoke and room see the same live
 * emission. This is an artistic combustion model, not calibrated spectroscopy. */
window.createFireOptics = () => `
  uniform float gasFlame;
  uniform vec3 flameTint;
  uniform float tintStrength;
  uniform float powerFlame;
  const vec3 fireExtent=${window.FireDomain?.extentGLSL||"vec3(14.,7.875,1.8)"};
  const vec3 fireMin=${window.FireDomain?.minimumGLSL||"vec3(-7.,-1.05,-.9)"};
  const float domainBlast=${window.FireDomain?.blast?"1.":"0."};
  float sootExtinction(float soot){return max(soot,0.)*(domainBlast>.5?6.4:4.4);}
  vec3 powerSpectrum(float temperature){
    // The same temperature-to-Kelvin Planck spectrum used by Volume. The
    // power mode is explicit so ordinary fire retains its authored palette.
    float kelvin=clamp(300.+1200.*temperature,700.,2800.);
    vec3 wavelength=vec3(.61,.55,.46);
    vec3 spectrum=pow(vec3(.61)/wavelength,vec3(5.))
      *(exp(14388./(.61*kelvin))-1.)/(exp(vec3(14388.)/(wavelength*kelvin))-vec3(1.));
    return mix(spectrum,mix(flameTint,vec3(1.),clamp(spectrum.b,0.,1.)*.5),tintStrength);
  }
  vec3 sootEmission(float soot,float temperature){
    if(powerFlame>.5){
      if(temperature<=.55||soot<=0.)return vec3(0);
      float heat=max(temperature-.55,0.);
      return powerSpectrum(temperature)*max(soot,0.)*heat*heat*heat*heat*.12;
    }
    float heat=max(temperature-.65,0.);
    return vec3(1.,.12,.015)*max(soot,0.)*heat*heat*.30;
  }
  vec3 fireEmission(float reaction,float temperature){
    if(powerFlame>.5){
      if(temperature<=.2||reaction<=0.)return vec3(0);
      float heat=max(temperature-.2,0.);
      return powerSpectrum(temperature)*max(reaction,0.)*3.2*heat*heat;
    }
    float hot=domainBlast>.5?smoothstep(.8,2.5,temperature):clamp((temperature-.28)/1.8,0.,1.);
    vec3 spectrum=domainBlast>.5?vec3(1.,.055+.78*pow(hot,1.6),.003+.36*pow(hot,3.8)):vec3(1.,.035+.93*pow(hot,1.3),.002+.72*pow(hot,3.0));
    spectrum=mix(spectrum,mix(vec3(.035,.20,1.),vec3(.38,.70,1.),hot),gasFlame);
    spectrum=mix(spectrum,mix(flameTint,vec3(1.),hot*.45),tintStrength);
    return spectrum*pow(max(reaction,0.),domainBlast>.5?1.08:.95)*(domainBlast>.5?3.8:6.5);
  }
`;

window.FireOptics=window.createFireOptics();
