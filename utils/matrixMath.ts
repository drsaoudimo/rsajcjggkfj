
import { Matrix } from '../types';

export class MatrixMath {
  static transpose(A: Matrix): Matrix {
    const rows = A.length;
    const cols = A[0].length;
    const res = Array(cols).fill(0).map(() => Array(rows).fill(0));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        res[j][i] = A[i][j];
      }
    }
    return res;
  }

  static multiply(A: Matrix, B: Matrix): Matrix {
    const r1 = A.length;
    const c1 = A[0].length;
    const r2 = B.length;
    const c2 = B[0].length;
    
    if (c1 !== r2) throw new Error(`Dimension mismatch: ${r1}x${c1} vs ${r2}x${c2}`);
    
    const res = Array(r1).fill(0).map(() => Array(c2).fill(0));
    for (let i = 0; i < r1; i++) {
      for (let j = 0; j < c2; j++) {
        let sum = 0;
        for (let k = 0; k < c1; k++) {
          sum += A[i][k] * B[k][j];
        }
        res[i][j] = sum;
      }
    }
    return res;
  }

  static add(A: Matrix, B: Matrix): Matrix {
    if (A.length !== B.length || A[0].length !== B[0].length) throw new Error("Dimension mismatch for add");
    return A.map((row, i) => row.map((val, j) => val + B[i][j]));
  }

  static subtract(A: Matrix, B: Matrix): Matrix {
    if (A.length !== B.length || A[0].length !== B[0].length) throw new Error("Dimension mismatch for subtract");
    return A.map((row, i) => row.map((val, j) => val - B[i][j]));
  }

  static multiplyScalar(A: Matrix, scalar: number): Matrix {
    return A.map(row => row.map(val => val * scalar));
  }

  static inverse(A: Matrix): Matrix {
    const n = A.length;
    if (n !== A[0].length) throw new Error("Matrix must be square");

    const M = A.map((row, i) => [
      ...row,
      ...Array(n).fill(0).map((_, j) => (i === j ? 1 : 0))
    ]);

    for (let i = 0; i < n; i++) {
      let pivot = M[i][i];
      let pivotRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(pivot)) {
          pivot = M[k][i];
          pivotRow = k;
        }
      }

      [M[i], M[pivotRow]] = [M[pivotRow], M[i]];

      if (Math.abs(pivot) < 1e-10) throw new Error("Matrix is singular");
      for (let j = 0; j < 2 * n; j++) M[i][j] /= pivot;

      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = M[k][i];
          for (let j = 0; j < 2 * n; j++) {
            M[k][j] -= factor * M[i][j];
          }
        }
      }
    }
    return M.map(row => row.slice(n));
  }
  
  static identity(size: number): Matrix {
    return Array(size).fill(0).map((_, i) => Array(size).fill(0).map((_, j) => i === j ? 1 : 0));
  }

  static createMetricMatrix(M: Matrix, targetSize: number): Matrix {
    const G = this.identity(targetSize);
    let flatM = M.flat();
    for(let i=0; i<targetSize; i++) {
       G[i][i] = Math.abs(flatM[i % flatM.length]) / 100.0 + 0.1;
    }
    return G;
  }

  static colVector(v: number[]): Matrix {
    return v.map(val => [val]);
  }

  static flatten(A: Matrix): number[] {
    return A.map(row => row[0]);
  }

  static dot(v1: number[], v2: number[]): number {
    return v1.reduce((sum, val, i) => sum + val * v2[i], 0);
  }

  static normSq(v: number[]): number {
    return this.dot(v, v);
  }

  static norm(v: number[]): number {
    return Math.sqrt(this.normSq(v));
  }

  static getColumns(A: Matrix): Matrix {
    const cols = A[0].length;
    const result = [];
    for(let i=0; i<cols; i++) {
      result.push(A.map(row => row[i]));
    }
    return result;
  }

  static gramSchmidt(basis: number[][]): { star: number[][], mu: number[][] } {
    const n = basis.length; 
    const star: number[][] = basis.map(b => [...b]); 
    const mu: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        mu[i][j] = this.dot(basis[i], star[j]) / this.normSq(star[j]);
        for (let k = 0; k < basis[0].length; k++) {
          star[i][k] -= mu[i][j] * star[j][k];
        }
      }
    }
    return { star, mu };
  }

  static lll(basisCols: number[][], delta: number = 0.99): number[][] {
    const basis = basisCols.map(col => [...col]);
    const n = basis.length; 
    let k = 1;

    let { star, mu } = this.gramSchmidt(basis);

    let loops = 0;
    while (k < n && loops < 2000) {
      loops++;
      for (let j = k - 1; j >= 0; j--) {
        if (Math.abs(mu[k][j]) > 0.5) {
          const q = Math.round(mu[k][j]);
          for (let dim = 0; dim < basis[0].length; dim++) {
            basis[k][dim] -= q * basis[j][dim];
          }
          const gs = this.gramSchmidt(basis);
          star = gs.star;
          mu = gs.mu;
        }
      }

      const starK = this.normSq(star[k]);
      const starKm1 = this.normSq(star[k - 1]);
      if (starK >= (delta - mu[k][k - 1] * mu[k][k - 1]) * starKm1) {
        k++;
      } else {
        [basis[k], basis[k - 1]] = [basis[k - 1], basis[k]];
        const gs = this.gramSchmidt(basis);
        star = gs.star;
        mu = gs.mu;
        k = Math.max(k - 1, 1);
      }
    }
    return basis;
  }

  /**
   * Babai's Nearest Plane Algorithm
   * Finds a vector in the lattice (generated by LLL-reduced basis) 
   * close to the target vector.
   */
  static babaiNearestPlane(basis: number[][], target: number[]): number[] {
    const { star } = this.gramSchmidt(basis);
    const n = basis.length;
    let b = [...target];
    const coefficients = Array(n).fill(0);
    
    for (let i = n - 1; i >= 0; i--) {
      const c = Math.round(this.dot(b, star[i]) / this.normSq(star[i]));
      coefficients[i] = c;
      for (let dim = 0; dim < b.length; dim++) {
        b[dim] -= c * basis[i][dim];
      }
    }
    // The lattice vector is sum(c_i * basis_i)
    const result = Array(target.length).fill(0);
    for (let i = 0; i < n; i++) {
        for (let dim = 0; dim < target.length; dim++) {
            result[dim] += coefficients[i] * basis[i][dim];
        }
    }
    return result;
  }

  static getSingularValues(A: Matrix): number[] {
    const AT = this.transpose(A);
    const ATA = this.multiply(AT, A); 
    const n = ATA.length;
    
    let D = ATA.map(row => [...row]); 
    const maxIter = 100;
    for(let iter=0; iter<maxIter; iter++) {
        let maxVal = 0;
        let p = 0, q = 0;
        for(let i=0; i<n; i++) {
            for(let j=i+1; j<n; j++) {
                if(Math.abs(D[i][j]) > maxVal) {
                    maxVal = Math.abs(D[i][j]);
                    p = i; q = j;
                }
            }
        }
        if(maxVal < 1e-12) break;
        
        const phi = 0.5 * Math.atan2(2 * D[p][q], D[q][q] - D[p][p]);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        
        const J = this.identity(n);
        J[p][p] = c; J[p][q] = s;
        J[q][p] = -s; J[q][q] = c;
        
        const JT = this.transpose(J);
        D = this.multiply(this.multiply(JT, D), J);
    }
    
    const eigenvalues = D.map((row, i) => Math.max(0, row[i]));
    return eigenvalues.map(e => Math.sqrt(e)).sort((a,b) => b-a);
  }

  static getConditionNumber(A: Matrix): number {
    const sv = this.getSingularValues(A);
    const max = sv[0];
    const min = sv[sv.length - 1] || 1e-10;
    return max / min;
  }
}
