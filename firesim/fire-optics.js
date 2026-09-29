/* Shared optical coefficients: the flame, smoke and room see the same live
 * emission. This is an artistic combustion model, not calibrated spectroscopy. */
window.createFireOptics = () => `
  uniform float gasFlame;
  uniform vec3 flameTint;
  uniform float tintStrength;
  const vec3 fireExtent=${window.FireDomain?.extentGLSL||"vec3(14.,7.875,1.8)"};
  const vec3 fireMin=${window.FireDomain?.minimumGLSL||"vec3(-7.,-1.05,-.9)"};
  const float domainBlast=${window.FireDomain?.blast?"1.":"0."};
  float sootExtinction(float soot){return max(soot,0.)*(domainBlast>.5?6.4:4.4);}
  vec3 sootEmission(float soot,float temperature){
    float heat=max(temperature-.65,0.);
    return vec3(1.,.12,.015)*max(soot,0.)*heat*heat*.30;
  }
  vec3 fireEmission(float reaction,float temperature){
    float hot=domainBlast>.5?smoothstep(.8,2.5,temperature):clamp((temperature-.28)/1.8,0.,1.);
    // Keep the wood/oil core amber at the temperatures reached by the live
    // solver. The old green and blue maxima made broad hot regions near white.
    vec3 spectrum=domainBlast>.5?vec3(1.,.055+.78*pow(hot,1.6),.003+.36*pow(hot,3.8)):vec3(1.,.025+.75*pow(hot,1.65),.001+.25*pow(hot,3.4));
    spectrum=mix(spectrum,mix(vec3(.035,.20,1.),vec3(.38,.70,1.),hot),gasFlame);
    spectrum=mix(spectrum,mix(flameTint,vec3(1.),hot*.45),tintStrength);
    return spectrum*pow(max(reaction,0.),domainBlast>.5?1.08:.95)*(domainBlast>.5?3.8:6.5);
  }
`;

window.FireOptics=window.createFireOptics();
